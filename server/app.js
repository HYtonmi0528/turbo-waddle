const express = require('express');
const multer = require('multer');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool, withTransaction } = require('./lib/db');
const { loadConfig } = require('./lib/config');
const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashToken
} = require('./lib/passwords');
const { importRfqWorkbook } = require('./services/rfqImporter');
const { exportCompletedRfq } = require('./services/rfqExporter');
const { listTemplates, deleteTemplate, generateExcel, getTemplatesDir } = require('./services/templateService');
const { logger } = require('./lib/logger');

const uuid = () => crypto.randomUUID();
const now = () => new Date();
const json = value => value == null ? null : JSON.stringify(value);
const parseJson = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
};

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApp() {
  const config = loadConfig();
  const uploadDir = path.join(config.storageDir, 'incoming');
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 100 * 1024 * 1024 }
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));

  app.use(session({
    secret: crypto.randomBytes(32).toString('hex'),
    name: 'latic_sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    }
  }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: '登录尝试过于频繁，请15分钟后再试' }
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: { message: '请求过于频繁' }
  });

  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth/register', loginLimiter);
  app.use('/api/', apiLimiter);

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (res.statusCode >= 400) {
        logger.warn(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      } else {
        logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      }
    });
    next();
  });

  app.get('/api/health', asyncRoute(async (req, res) => {
    await getPool().query('SELECT 1');
    res.json({ ok: true, service: 'LATIC RFQ Server', time: new Date().toISOString() });
  }));

  app.get('/api/setup/status', asyncRoute(async (req, res) => {
    const [[row]] = await getPool().query('SELECT COUNT(*) AS count FROM users');
    res.json({ initialized: Number(row.count) > 0, canInitialize: true });
  }));

  app.post('/api/setup/admin', asyncRoute(async (req, res) => {
    const [[row]] = await getPool().query('SELECT COUNT(*) AS count FROM users');
    if (Number(row.count) > 0) return res.status(409).json({ message: '系统已经完成初始化' });
    const { username, displayName, password } = req.body || {};
    if (!username || !displayName) return res.status(400).json({ message: '请输入管理员账号和姓名' });
    const passwordData = await hashPassword(password);
    const id = uuid();
    const timestamp = now();
    await getPool().execute(
      `INSERT INTO users
       (id, username, display_name, password_hash, password_salt, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?)`,
      [id, username.trim(), displayName.trim(), passwordData.hash, passwordData.salt, timestamp, timestamp]
    );
    res.status(201).json({ id, username, displayName, role: 'admin' });
  }));

  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    const { username, displayName, password } = req.body || {};
    if (!username || !displayName) return res.status(400).json({ message: '请输入账号和姓名' });
    const passwordData = await hashPassword(password);
    const id = uuid();
    const timestamp = now();
    try {
      await getPool().execute(
        `INSERT INTO users
         (id, username, display_name, password_hash, password_salt, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'viewer', 'pending', ?, ?)`,
        [id, username.trim(), displayName.trim(), passwordData.hash, passwordData.salt, timestamp, timestamp]
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: '该账号已经存在' });
      throw error;
    }
    res.status(201).json({ id, status: 'pending', message: '注册成功，请等待管理员启用账号' });
  }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const { username, password, entrance } = req.body || {};
    const [[user]] = await getPool().execute('SELECT * FROM users WHERE username = ?', [username || '']);
    if (!user || !(await verifyPassword(password || '', user.password_salt, user.password_hash))) {
      return res.status(401).json({ message: '账号或密码错误' });
    }
    if (user.status !== 'active') return res.status(403).json({ message: '账号尚未启用或已被停用' });
    if (entrance === 'admin' && !['admin', 'manager'].includes(user.role)) {
      return res.status(403).json({ message: '该账号没有管理权限' });
    }
    if (entrance === 'employee' && ['admin', 'manager'].includes(user.role)) {
      return res.status(403).json({ message: '请从管理员入口登录' });
    }
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await getPool().execute(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [hashToken(token), user.id, expiresAt, now()]
    );
    req.session.userId = user.id;
    const responseUser = { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
    logger.info(`用户登录: ${user.display_name} (${user.role})`);
    res.json({ token, user: responseUser });
  }));

  const authenticate = asyncRoute(async (req, res, next) => {
    if (req.session?.userId) {
      const [[user]] = await getPool().execute(
        'SELECT id, username, display_name displayName, role, status FROM users WHERE id = ?',
        [req.session.userId]
      );
      if (!user || user.status !== 'active') {
        req.session.destroy(() => {});
        return res.status(401).json({ message: '登录已失效，请重新登录' });
      }
      req.user = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role
      };
      return next();
    }
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: '请先登录' });
    const [[user]] = await getPool().execute(
      `SELECT u.id, u.username, u.display_name displayName, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW(3)`,
      [hashToken(token)]
    );
    if (!user || user.status !== 'active') return res.status(401).json({ message: '登录已失效，请重新登录' });
    req.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role
    };
    next();
  });

  const requireRole = (...roles) => (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ message: '权限不足' });

  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', authenticate, asyncRoute(async (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token) await getPool().execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    req.session.destroy(() => {});
    res.json({ ok: true });
  }));

  app.get('/api/users', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().query(
      `SELECT id, username, display_name AS displayName, role, status, created_at AS createdAt
       FROM users ORDER BY role, display_name`
    );
    res.json({ users: rows });
  }));
  app.patch('/api/users/:id/status', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const status = ['active', 'disabled'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ message: '无效的账号状态' });
    await getPool().execute('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [status, now(), req.params.id]);
    res.json({ ok: true });
  }));
  app.patch('/api/users/:id/role', authenticate, requireRole('admin'), asyncRoute(async (req, res) => {
    const role = ['admin', 'manager', 'purchaser', 'viewer'].includes(req.body?.role) ? req.body.role : null;
    if (!role) return res.status(400).json({ message: '无效的角色，可选：admin, manager, purchaser, viewer' });
    await getPool().execute('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, now(), req.params.id]);
    logger.info(`用户角色变更: ${req.params.id} -> ${role} by ${req.user.displayName}`);
    res.json({ ok: true });
  }));

  app.get('/api/templates', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      `SELECT id, owner_id AS ownerId, name, type, description, original_name AS originalName,
              structure_json AS structure, mappings_json AS mappings, is_shared AS isShared,
              created_at AS createdAt, updated_at AS updatedAt
       FROM user_templates WHERE owner_id = ? OR is_shared = 1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ templates: rows.map(row => ({
      ...row,
      structure: parseJson(row.structure, null),
      mappings: parseJson(row.mappings, []),
      isShared: Boolean(row.isShared)
    })) });
  }));
  app.post('/api/templates', authenticate, asyncRoute(async (req, res) => {
    const id = uuid();
    const timestamp = now();
    const template = req.body || {};
    if (!template.name) return res.status(400).json({ message: '模板名称不能为空' });
    await getPool().execute(
      `INSERT INTO user_templates
       (id, owner_id, name, type, description, original_name, structure_json, mappings_json, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, template.name, template.type || '通用', template.description || null,
        template.originalName || null, json(template.structure), json(template.mappings || []),
        template.isShared ? 1 : 0, timestamp, timestamp]
    );
    res.status(201).json({ id });
  }));

  async function createNotifications(connection, taskId, title, message) {
    const [users] = await connection.query("SELECT id FROM users WHERE status = 'active'");
    for (const user of users) {
      await connection.execute(
        `INSERT INTO notifications (id, user_id, type, title, message, task_id, is_read, created_at)
         VALUES (?, ?, 'task', ?, ?, ?, 0, ?)`,
        [uuid(), user.id, title, message, taskId, now()]
      );
    }
  }

  app.post('/api/tasks/import', authenticate, requireRole('admin', 'manager'), upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择Excel询价单' });
    let imported;
    try {
      imported = await importRfqWorkbook(req.file.path);
    } catch (error) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      throw error;
    }
    const taskId = uuid();
    const taskDir = path.join(config.storageDir, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const safeOriginalName = path.basename(req.file.originalname).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const sourcePath = path.join(taskDir, safeOriginalName);
    fs.renameSync(req.file.path, sourcePath);
    const taskNo = String(req.body.taskNo || `RFQ-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-4)}`);
    const title = String(req.body.title || safeOriginalName.replace(/\.xlsx$/i, ''));
    const timestamp = now();
    await withTransaction(async connection => {
      await connection.execute(
        `INSERT INTO rfq_tasks
         (id, task_no, title, requester, country, client_name, request_date, deadline,
          import_type, delivery_type, payment_type, status, source_original_name,
          source_storage_path, assigned_user_ids, metadata_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`,
        [taskId, taskNo, title, imported.metadata.requester || null, imported.metadata.country || null,
          imported.metadata.client || null, imported.metadata.requestDate || null, req.body.deadline || null,
          imported.metadata.importType || null, imported.metadata.deliveryType || null,
          imported.metadata.paymentType || null, safeOriginalName, sourcePath,
          json(parseJson(req.body.assignedUserIds, [])), json({ sheetName: imported.sheetName, headerRow: imported.headerRow }),
          req.user.id, timestamp, timestamp]
      );
      for (const item of imported.items) {
        await connection.execute(
          `INSERT INTO rfq_items
           (id, task_id, line_no, description, quantity, unit, product_code, ltc, remarks,
            attachments_json, source_json, row_version, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 1, ?, ?, ?)`,
          [uuid(), taskId, item.lineNo, item.description, item.quantity, item.unit || null,
            item.code || null, item.ltc || null, item.observation || null, json(item.source),
            req.user.id, timestamp, timestamp]
        );
      }
      await createNotifications(connection, taskId, '收到新询价任务', `${title}，共 ${imported.items.length} 项产品`);
      await connection.execute(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id, created_at)
         VALUES ('task', ?, 'import', ?, ?, ?)`,
        [taskId, json({ taskNo, title, itemCount: imported.items.length }), req.user.id, timestamp]
      );
    });
    res.status(201).json({ id: taskId, taskNo, title, itemCount: imported.items.length });
  }));

  app.get('/api/tasks', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().query(
      `SELECT t.id, t.task_no AS taskNo, t.title, t.requester, t.country,
              t.client_name AS clientName, t.request_date AS requestDate, t.deadline,
              t.import_type AS importType, t.delivery_type AS deliveryType,
              t.status, t.assigned_user_ids AS assignedUserIds, t.updated_at AS updatedAt,
              COUNT(i.id) AS itemCount,
              SUM(CASE WHEN i.fob_usd IS NOT NULL THEN 1 ELSE 0 END) AS completedCount
       FROM rfq_tasks t LEFT JOIN rfq_items i ON i.task_id = t.id
       GROUP BY t.id ORDER BY t.updated_at DESC`
    );
    res.json({ tasks: rows.map(row => ({
      ...row,
      assignedUserIds: parseJson(row.assignedUserIds, []),
      itemCount: Number(row.itemCount || 0),
      completedCount: Number(row.completedCount || 0)
    })) });
  }));

  app.get('/api/tasks/stats', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().query('SELECT status, COUNT(*) AS count FROM rfq_tasks GROUP BY status');
    const [items] = await getPool().query('SELECT COUNT(*) AS totalItems, SUM(CASE WHEN fob_usd IS NOT NULL THEN 1 ELSE 0 END) AS filledItems FROM rfq_items');
    res.json({ byStatus: rows, totalItems: Number(items[0].totalItems || 0), filledItems: Number(items[0].filledItems || 0) });
  }));

  app.get('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
    const [[task]] = await getPool().execute(
      `SELECT id, task_no AS taskNo, title, requester, country, client_name AS clientName,
              request_date AS requestDate, deadline, import_type AS importType,
              delivery_type AS deliveryType, payment_type AS paymentType, status,
              source_original_name AS sourceOriginalName, assigned_user_ids AS assignedUserIds,
              current_version AS currentVersion, created_at AS createdAt, updated_at AS updatedAt
       FROM rfq_tasks WHERE id = ?`,
      [req.params.id]
    );
    if (!task) return res.status(404).json({ message: '任务不存在' });
    const [items] = await getPool().execute(
      `SELECT i.id, i.line_no AS lineNo, i.description, i.quantity, i.unit,
              i.product_code AS productCode, i.ltc, i.fob_usd AS fobUsd,
              i.total_usd AS totalUsd, i.total_rmb AS totalRmb,
              i.exchange_rate AS exchangeRate, i.invoice_type AS invoiceType,
              i.selected_supplier AS selectedSupplier, i.selected_quote_json AS selectedQuote,
              i.remarks, i.attachments_json AS attachments,
              i.source_json AS source, i.row_version AS rowVersion,
              i.updated_at AS updatedAt, u.display_name AS updatedByName
       FROM rfq_items i LEFT JOIN users u ON u.id = i.updated_by
       WHERE i.task_id = ? ORDER BY i.line_no`,
      [req.params.id]
    );
    task.assignedUserIds = parseJson(task.assignedUserIds, []);
    res.json({ task, items: items.map(item => ({
      ...item,
      attachments: parseJson(item.attachments, []).map(({ storagePath, ...attachment }) => attachment),
      selectedQuote: parseJson(item.selectedQuote, {}),
      source: parseJson(item.source, {})
    })) });
  }));

  app.get('/api/tasks/:id/source', authenticate, asyncRoute(async (req, res) => {
    const [[task]] = await getPool().execute(
      'SELECT source_original_name, source_storage_path FROM rfq_tasks WHERE id = ?',
      [req.params.id]
    );
    if (!task || !task.source_storage_path || !fs.existsSync(task.source_storage_path)) {
      return res.status(404).json({ message: '原始询价单文件不存在' });
    }
    res.download(task.source_storage_path, task.source_original_name);
  }));

  app.get('/api/tasks/:id/export', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const [[task]] = await getPool().execute(
      'SELECT id, source_original_name, source_storage_path FROM rfq_tasks WHERE id = ?',
      [req.params.id]
    );
    if (!task || !task.source_storage_path || !fs.existsSync(task.source_storage_path)) {
      return res.status(404).json({ message: '原始询价单文件不存在' });
    }
    const [items] = await getPool().execute(
      `SELECT line_no AS lineNo, fob_usd AS fobUsd, total_rmb AS totalRmb, remarks,
              attachments_json AS attachments
       FROM rfq_items WHERE task_id = ? ORDER BY line_no`,
      [req.params.id]
    );
    const exportDir = path.join(config.storageDir, 'tasks', task.id, 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const originalBase = path.basename(task.source_original_name || '询价单.xlsx').replace(/\.xlsx$/i, '');
    const downloadName = `已填写_${originalBase}.xlsx`;
    const outputPath = path.join(exportDir, `${Date.now()}-${downloadName}`);
    await exportCompletedRfq(task.source_storage_path, outputPath, items.map(item => ({
      ...item,
      attachments: parseJson(item.attachments, [])
    })));
    await getPool().execute(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id, created_at)
       VALUES ('task', ?, 'export', ?, ?, ?)`,
      [task.id, json({ fileName: downloadName, itemCount: items.length }), req.user.id, now()]
    );
    res.download(outputPath, downloadName);
  }));

  app.patch('/api/tasks/:taskId/items/:itemId', authenticate, asyncRoute(async (req, res) => {
    const expectedVersion = Number(req.body?.rowVersion);
    const result = await withTransaction(async connection => {
      const [[current]] = await connection.execute(
        'SELECT * FROM rfq_items WHERE id = ? AND task_id = ? FOR UPDATE',
        [req.params.itemId, req.params.taskId]
      );
      if (!current) return { notFound: true };
      if (!Number.isInteger(expectedVersion) || current.row_version !== expectedVersion) {
        return { conflict: true, current };
      }
      const fob = req.body.fobUsd === '' || req.body.fobUsd == null ? null : Number(req.body.fobUsd);
      if (fob != null && (!Number.isFinite(fob) || fob < 0)) throw new Error('FOB必须是非负数字');
      const totalRmb = req.body.totalRmb === '' || req.body.totalRmb == null ? null : Number(req.body.totalRmb);
      if (totalRmb != null && (!Number.isFinite(totalRmb) || totalRmb < 0)) throw new Error('含税运人民币必须是非负数字');
      const exchangeRate = req.body.exchangeRate === '' || req.body.exchangeRate == null ? null : Number(req.body.exchangeRate);
      if (exchangeRate != null && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) throw new Error('汇率必须大于0');
      const invoiceType = req.body.invoiceType === 'regular' ? 'regular' : 'special';
      const calculatedFob = totalRmb != null && exchangeRate
        ? totalRmb / exchangeRate / (invoiceType === 'special' ? 1.13 : 1)
        : fob;
      const total = calculatedFob == null || current.quantity == null ? null : calculatedFob * Number(current.quantity);
      const timestamp = now();
      await connection.execute(
        `UPDATE rfq_items SET fob_usd = ?, total_usd = ?, total_rmb = ?, exchange_rate = ?,
         invoice_type = ?, selected_supplier = ?, selected_quote_json = ?, remarks = ?, row_version = row_version + 1,
         updated_by = ?, updated_at = ? WHERE id = ?`,
        [calculatedFob, total, totalRmb, exchangeRate, invoiceType,
          req.body.selectedSupplier || null, json(req.body.selectedQuote || null),
          req.body.remarks || null, req.user.id, timestamp, current.id]
      );
      await connection.execute('UPDATE rfq_tasks SET status = ?, updated_at = ? WHERE id = ?',
        ['in_progress', timestamp, req.params.taskId]);
      await connection.execute(
        `INSERT INTO audit_logs (entity_type, entity_id, action, before_json, after_json, user_id, created_at)
         VALUES ('rfq_item', ?, 'update', ?, ?, ?, ?)`,
        [current.id, json({ fobUsd: current.fob_usd, totalRmb: current.total_rmb, remarks: current.remarks }),
          json({ fobUsd: calculatedFob, totalUsd: total, totalRmb, selectedSupplier: req.body.selectedSupplier || null,
            remarks: req.body.remarks || null }), req.user.id, timestamp]
      );
      return { rowVersion: current.row_version + 1, fobUsd: calculatedFob, totalUsd: total,
        totalRmb, exchangeRate, invoiceType, selectedSupplier: req.body.selectedSupplier || null,
        updatedAt: timestamp };
    });
    if (result.notFound) return res.status(404).json({ message: '产品明细不存在' });
    if (result.conflict) return res.status(409).json({
      message: '该行刚刚被其他员工修改，请刷新后比较数据',
      current: result.current
    });
    res.json(result);
  }));

  app.post('/api/tasks/:taskId/items/:itemId/attachments', authenticate, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择附件' });
    const [[item]] = await getPool().execute(
      'SELECT attachments_json FROM rfq_items WHERE id = ? AND task_id = ?',
      [req.params.itemId, req.params.taskId]
    );
    if (!item) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ message: '产品明细不存在' });
    }
    const attachmentId = uuid();
    const attachmentDir = path.join(config.storageDir, 'tasks', req.params.taskId, 'attachments');
    fs.mkdirSync(attachmentDir, { recursive: true });
    const safeName = path.basename(req.file.originalname).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const targetPath = path.join(attachmentDir, `${attachmentId}-${safeName}`);
    fs.renameSync(req.file.path, targetPath);
    const extension = path.extname(safeName).slice(1).toLowerCase();
    const attachment = {
      id: attachmentId,
      name: safeName,
      size: req.file.size,
      kind: ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension) ? 'image' : 'file',
      uploadedBy: req.user.displayName,
      uploadedAt: new Date().toISOString(),
      storagePath: targetPath
    };
    const attachments = parseJson(item.attachments_json, []);
    attachments.push(attachment);
    await getPool().execute(
      'UPDATE rfq_items SET attachments_json = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?',
      [json(attachments), req.user.id, now(), req.params.itemId]
    );
    res.status(201).json({ attachment: { ...attachment, storagePath: undefined } });
  }));

  app.get('/api/tasks/:taskId/items/:itemId/attachments/:attachmentId', authenticate, asyncRoute(async (req, res) => {
    const [[item]] = await getPool().execute(
      'SELECT attachments_json FROM rfq_items WHERE id = ? AND task_id = ?',
      [req.params.itemId, req.params.taskId]
    );
    const attachment = parseJson(item?.attachments_json, []).find(entry => entry.id === req.params.attachmentId);
    if (!attachment || !attachment.storagePath || !fs.existsSync(attachment.storagePath)) {
      return res.status(404).json({ message: '附件不存在' });
    }
    res.download(attachment.storagePath, attachment.name);
  }));

  app.post('/api/tasks/:taskId/items/:itemId/revert', authenticate, asyncRoute(async (req, res) => {
    const [[current]] = await getPool().execute(
      'SELECT * FROM rfq_items WHERE id = ? AND task_id = ?',
      [req.params.itemId, req.params.taskId]
    );
    if (!current) return res.status(404).json({ message: '产品明细不存在' });

    const [logs] = await getPool().execute(
      `SELECT before_json, after_json FROM audit_logs
       WHERE entity_type = 'rfq_item' AND entity_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [current.id]
    );
    if (logs.length === 0) return res.status(404).json({ message: '没有可还原的历史记录' });
    const before = parseJson(logs[0].before_json, {});
    await getPool().execute(
      `UPDATE rfq_items SET fob_usd = ?, total_usd = ?, total_rmb = ?, selected_supplier = ?,
       remarks = ?, row_version = row_version + 1, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [before.fobUsd || null, before.totalUsd || null, before.totalRmb || null,
        before.selectedSupplier || null, before.remarks || null,
        req.user.id, now(), current.id]
    );
    await getPool().execute(
      `INSERT INTO audit_logs (entity_type, entity_id, action, before_json, after_json, user_id, created_at)
       VALUES ('rfq_item', ?, 'revert', ?, ?, ?, ?)`,
      [current.id, json({ fobUsd: current.fob_usd, totalRmb: current.total_rmb }),
        json({ fobUsd: before.fobUsd, totalRmb: before.totalRmb }), req.user.id, now()]
    );
    logger.info(`数据还原: item=${req.params.itemId} task=${req.params.taskId} by ${req.user.displayName}`);
    res.json({ ok: true, rowVersion: current.row_version + 1 });
  }));

  app.get('/api/tasks/:id/export/csv', authenticate, asyncRoute(async (req, res) => {
    const [[task]] = await getPool().execute(
      'SELECT title, task_no FROM rfq_tasks WHERE id = ?', [req.params.id]
    );
    if (!task) return res.status(404).json({ message: '任务不存在' });
    const [items] = await getPool().execute(
      `SELECT line_no, description, quantity, unit, product_code, fob_usd, total_rmb,
              selected_supplier, remarks FROM rfq_items WHERE task_id = ? ORDER BY line_no`,
      [req.params.id]
    );
    const headers = ['行号','描述','数量','单位','产品代码','FOB USD','含税运RMB','供应商','备注'];
    const csv = [headers.join(','), ...items.map(i => headers.map(h => {
      const val = i[h === '行号' ? 'line_no' : h === '描述' ? 'description' : h === '数量' ? 'quantity' : h === '单位' ? 'unit' : h === '产品代码' ? 'product_code' : h === 'FOB USD' ? 'fob_usd' : h === '含税运RMB' ? 'total_rmb' : h === '供应商' ? 'selected_supplier' : 'remarks'];
      return val == null ? '' : `"${String(val).replace(/"/g, '""')}"`;
    }).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(task.task_no || task.title)}.csv"`);
    res.end('\uFEFF' + csv);
  }));

  app.post('/api/tasks/:id/submit-review', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('UPDATE rfq_tasks SET status = ?, updated_at = ? WHERE id = ?', ['review', now(), req.params.id]);
    const [reviewers] = await getPool().query("SELECT id FROM users WHERE role IN ('admin','manager') AND status = 'active'");
    for (const reviewer of reviewers) {
      await getPool().execute(
        `INSERT INTO notifications (id, user_id, type, title, message, task_id, is_read, created_at)
         VALUES (?, ?, 'review', '询价任务等待审核', ?, ?, 0, ?)`,
        [uuid(), reviewer.id, `${req.user.displayName}提交了任务`, req.params.id, now()]
      );
    }
    res.json({ ok: true });
  }));

  app.post('/api/tasks/:id/snapshots', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const result = await withTransaction(async connection => {
      const [[task]] = await connection.execute('SELECT * FROM rfq_tasks WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!task) return null;
      const [items] = await connection.execute('SELECT * FROM rfq_items WHERE task_id = ? ORDER BY line_no', [req.params.id]);
      const version = Number(task.current_version || 1);
      await connection.execute(
        `INSERT INTO task_snapshots (id, task_id, version_no, snapshot_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuid(), task.id, version, json({ task, items }), req.user.id, now()]
      );
      await connection.execute(
        'UPDATE rfq_tasks SET status = ?, current_version = ?, updated_at = ? WHERE id = ?',
        ['submitted', version + 1, now(), task.id]
      );
      return { version };
    });
    if (!result) return res.status(404).json({ message: '任务不存在' });
    res.status(201).json(result);
  }));

  app.get('/api/notifications', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      `SELECT id, type, title, message, task_id AS taskId, is_read AS isRead, created_at AS createdAt
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ notifications: rows.map(row => ({ ...row, isRead: Boolean(row.isRead) })) });
  }));
  app.patch('/api/notifications/:id/read', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute(
      'UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ?',
      [now(), req.params.id, req.user.id]
    );
    res.json({ ok: true });
  }));

  app.get('/api/tasks/:id/audit', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      `SELECT a.id, a.entity_type AS entityType, a.entity_id AS entityId, a.action,
              a.before_json AS beforeData, a.after_json AS afterData,
              a.created_at AS createdAt, u.display_name AS userName
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE (a.entity_type = 'task' AND a.entity_id = ?)
          OR (a.entity_type = 'rfq_item' AND a.entity_id IN (SELECT id FROM rfq_items WHERE task_id = ?))
       ORDER BY a.created_at DESC LIMIT 300`,
      [req.params.id, req.params.id]
    );
    res.json({ audit: rows });
  }));

  app.get('/api/mytemplates', authenticate, asyncRoute(async (req, res) => {
    res.json({ templates: await listTemplates(req.user.id) });
  }));
  app.delete('/api/mytemplates/:id', authenticate, asyncRoute(async (req, res) => {
    await deleteTemplate(req.user.id, req.params.id);
    res.json({ ok: true });
  }));
  app.get('/api/templates/:id/structure', authenticate, asyncRoute(async (req, res) => {
    const [[row]] = await getPool().execute('SELECT structure_json FROM user_templates WHERE id = ?', [req.params.id]);
    res.json(row ? parseJson(row.structure_json, {}) : {});
  }));
  app.get('/api/templates/:id/mappings', authenticate, asyncRoute(async (req, res) => {
    const [[row]] = await getPool().execute('SELECT mappings_json FROM user_templates WHERE id = ?', [req.params.id]);
    res.json(row ? parseJson(row.mappings_json, []) : []);
  }));
  app.put('/api/templates/:id/mappings', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('UPDATE user_templates SET mappings_json = ?, updated_at = ? WHERE id = ?',
      [json(req.body), now(), req.params.id]);
    res.json({ ok: true });
  }));
  app.put('/api/templates/:id/structure', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('UPDATE user_templates SET structure_json = ?, updated_at = ? WHERE id = ?',
      [json(req.body), now(), req.params.id]);
    res.json({ ok: true });
  }));
  app.post('/api/templates/:id/duplicate', authenticate, asyncRoute(async (req, res) => {
    const [[orig]] = await getPool().execute('SELECT * FROM user_templates WHERE id = ?', [req.params.id]);
    if (!orig) return res.status(404).json({ message: '模板不存在' });
    const newId = uuid();
    const timestamp = now();
    await getPool().execute(
      `INSERT INTO user_templates (id, owner_id, name, type, description, original_name, structure_json, mappings_json, is_shared, storage_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, req.user.id, (orig.name || '') + ' (副本)', orig.type, orig.description, orig.original_name,
       orig.structure_json, orig.mappings_json, 0, orig.storage_path, timestamp, timestamp]
    );
    res.json({ id: newId });
  }));
  app.post('/api/templates/import', authenticate, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择模板文件' });
    const templateDir = getTemplatesDir();
    const id = uuid();
    const fileName = `${id}.xlsx`;
    const storagePath = path.join(templateDir, fileName);
    fs.copyFileSync(req.file.path, storagePath);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    const timestamp = now();
    const name = String(req.body.name || path.basename(req.file.originalname, '.xlsx'));
    await getPool().execute(
      `INSERT INTO user_templates (id, owner_id, name, type, description, original_name, structure_json, mappings_json, is_shared, storage_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, name, req.body.type || '通用', req.body.description || null, req.file.originalname,
       json({}), json([]), 0, storagePath, timestamp, timestamp]
    );
    res.json({ id, name });
  }));
  app.post('/api/excel/generate', authenticate, asyncRoute(async (req, res) => {
    const { templateId, batches, options } = req.body || {};
    if (!templateId) return res.status(400).json({ message: '请先选择模板' });
    const outputPath = await generateExcel(templateId, batches, options);
    res.download(outputPath, `生成表格_${new Date().toISOString().slice(0,10)}.xlsx`, () => {
      try { fs.unlinkSync(outputPath); } catch (_) {}
    });
  }));

  app.get('/api/data/entries', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      'SELECT id, type, data, created_at createdAt, updated_at updatedAt FROM data_entries WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json({ entries: rows.map(r => ({ ...r, data: parseJson(r.data, {}) })) });
  }));
  app.post('/api/data/entries', authenticate, asyncRoute(async (req, res) => {
    const id = req.body.id || uuid();
    const timestamp = now();
    await getPool().execute(
      `INSERT INTO data_entries (id, user_id, type, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)`,
      [id, req.user.id, req.body.type, json(req.body.data), timestamp, timestamp]
    );
    res.json({ success: true, id });
  }));
  app.delete('/api/data/entries/:id', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('DELETE FROM data_entries WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  app.get('/api/drafts/:templateId', authenticate, asyncRoute(async (req, res) => {
    const [[row]] = await getPool().execute(
      'SELECT payload, updated_at updatedAt FROM data_entry_drafts WHERE user_id = ? AND template_id = ?',
      [req.user.id, req.params.templateId]
    );
    res.json(row ? { payload: parseJson(row.payload, {}), updatedAt: row.updatedAt } : null);
  }));
  app.put('/api/drafts/:templateId', authenticate, asyncRoute(async (req, res) => {
    const id = `${req.user.id}:${req.params.templateId}`;
    const timestamp = now();
    const payload = json(req.body.payload || {});
    await getPool().execute(
      `INSERT INTO data_entry_drafts (id, user_id, template_id, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`,
      [id, req.user.id, req.params.templateId, payload, timestamp, timestamp]
    );
    res.json({ success: true, updatedAt: timestamp.toISOString() });
  }));
  app.delete('/api/drafts/:templateId', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('DELETE FROM data_entry_drafts WHERE user_id = ? AND template_id = ?',
      [req.user.id, req.params.templateId]);
    res.json({ ok: true });
  }));

  app.get('/api/fields', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().query('SELECT field_key AS `key`, label, category, data_type AS dataType FROM custom_system_fields ORDER BY label');
    res.json({ fields: rows });
  }));
  app.post('/api/fields', authenticate, asyncRoute(async (req, res) => {
    const { key, label, category, dataType } = req.body || {};
    if (!key || !label) return res.status(400).json({ message: '字段标识和名称不能为空' });
    await getPool().execute(
      'INSERT INTO custom_system_fields (field_key, label, category, data_type, created_by, created_at) VALUES (?,?,?,?,?,?)',
      [key, label, category || '自定义', dataType || 'text', req.user.id, now()]
    );
    res.json({ ok: true });
  }));
  app.delete('/api/fields/:key', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('DELETE FROM custom_system_fields WHERE field_key = ?', [req.params.key]);
    res.json({ ok: true });
  }));

  app.get('/api/quotes', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      `SELECT id, name, project_id AS projectId, options_json AS options, field_labels_json AS fieldLabels,
       created_at AS createdAt, updated_at AS updatedAt
       FROM quote_sets WHERE user_id = ? ORDER BY updated_at DESC`,
      [req.user.id]
    );
    const quoteSets = [];
    for (const row of rows) {
      const [items] = await getPool().execute(
        `SELECT id, item_index AS _quoteItemIndex, supplier_name AS supplierName,
         model, reference, description, price, total_price AS totalPrice, total_rmb AS totalRmb,
         notes, after_sales AS afterSales, data_json AS data
         FROM quote_items WHERE quote_set_id = ? ORDER BY item_index`,
        [row.id]
      );
      quoteSets.push({
        id: row.id, name: row.name, projectId: row.projectId,
        options: parseJson(row.options, {}),
        fieldLabels: parseJson(row.fieldLabels, {}),
        batches: [{ category: '全部', items: items.map(i => ({ ...i, data: parseJson(i.data, {}) })) }],
        createdAt: row.createdAt, updatedAt: row.updatedAt
      });
    }
    res.json({ quoteSets });
  }));
  app.post('/api/quotes', authenticate, asyncRoute(async (req, res) => {
    const { id, name, projectId, options, fieldLabels, batches } = req.body || {};
    if (!name) return res.status(400).json({ message: '报价集名称不能为空' });
    const quoteSetId = id || uuid();
    const timestamp = now();
    const allItems = [];
    if (batches && batches.length) {
      for (const batch of batches) {
        for (const item of (batch.items || [])) {
          allItems.push({ ...item, _category: batch.category });
        }
      }
    }
    await withTransaction(async conn => {
      await conn.execute(
        `INSERT INTO quote_sets (id, user_id, name, project_id, options_json, field_labels_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), project_id = VALUES(project_id),
         options_json = VALUES(options_json), field_labels_json = VALUES(field_labels_json), updated_at = VALUES(updated_at)`,
        [quoteSetId, req.user.id, name, projectId || null, json(options), json(fieldLabels), timestamp, timestamp]
      );
      if (allItems.length) {
        await conn.execute('DELETE FROM quote_items WHERE quote_set_id = ?', [quoteSetId]);
        for (let i = 0; i < allItems.length; i++) {
          const c = allItems[i];
          await conn.execute(
            `INSERT INTO quote_items (id, quote_set_id, item_index, supplier_name, model, reference,
             description, price, total_price, total_rmb, notes, after_sales, data_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuid(), quoteSetId, i, c.supplierName || null, c.model || null, c.reference || null,
             c.description || null, c.price || null, c.totalPrice || null, c.totalRmb || null,
             c.notes || null, c.afterSales || null, json(c.data || c), timestamp]
          );
        }
      }
    });
    res.json({ id: quoteSetId });
  }));
  app.delete('/api/quotes/:id', authenticate, asyncRoute(async (req, res) => {
    await getPool().execute('DELETE FROM quote_items WHERE quote_set_id = ?', [req.params.id]);
    await getPool().execute('DELETE FROM quote_sets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  app.get('/api/exchange-rate', authenticate, asyncRoute(async (req, res) => {
    res.json({ rate: 7.25, source: '默认' });
  }));

  const frontendDir = path.join(__dirname, '..', 'dist', 'renderer');
  const API_INIT_JS = require('fs').readFileSync(
    path.join(__dirname, 'api-init-compact.js'), 'utf8'
  );
  if (fs.existsSync(frontendDir)) {
    app.use('/api-init.js', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type('js').send(API_INIT_JS);
    });
    app.use(express.static(frontendDir, {
      maxAge: 0,
      setHeaders: (res) => res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    }));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ message: '接口不存在' });
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  app.use((error, req, res, next) => {
    logger.error(`${req.method} ${req.originalUrl} - ${error.message}`, { stack: error.stack });
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: '文件不能超过100MB' });
    res.status(error.status || 500).json({ message: error.message || '服务器内部错误' });
  });
  return app;
}

module.exports = { createApp };
