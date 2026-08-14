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
const { listTemplates, deleteTemplate, generateExcel, getTemplatesDir, parseTemplateStructure, decodeUploadedName } = require('./services/templateService');
const { getToday } = require('./services/exchangeRateService');
const { logger } = require('./lib/logger');
const packageVersion = require('../package.json').version;
const { inferSystemFieldKey } = require('../src/shared/templateMappings');

const uuid = () => crypto.randomUUID();
const now = () => new Date();
const json = value => value == null ? null : JSON.stringify(value);
const getCookie = (req, name) => {
  const raw = String(req.headers.cookie || '');
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
};
const parseJson = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
};

const normalizeRole = value => {
  const aliases = { general_manager: 'admin', supervisor: 'manager', overseas_sales: 'viewer', overseas: 'viewer', viewer: 'viewer', manager: 'manager', purchaser: 'purchaser', admin: 'admin' };
  return aliases[String(value || '').trim().toLowerCase()] || 'viewer';
};

// Built-in fields are always available to mapping, even before a user adds custom fields.
const BUILTIN_SYSTEM_FIELDS = [
  ['supplierName', '供应商名称', '供应商信息', 'text'], ['productName', '产品名称', '产品信息', 'text'],
  ['model', '型号/规格', '产品信息', 'text'], ['price', '价格/单价', '价格信息', 'number'],
  ['cost', '成本', '价格信息', 'number'], ['profit', '利润', '价格信息', 'number'], ['profitRate', '利润率', '价格信息', 'number'],
  ['totalPrice', '总价', '价格信息', 'number'], ['usdPrice', '美元单价', '价格信息', 'number'], ['usdTotalPrice', '美元总价', '价格信息', 'number'], ['usdCost', '美元成本', '价格信息', 'number'],
  ['quantity', '数量', '交易信息', 'number'], ['deliveryTime', '交货期', '交易信息', 'text'],
  ['paymentTerms', '付款方式', '交易信息', 'text'], ['afterSales', '售后政策', '售后信息', 'text'], ['warranty', '保修期', '售后信息', 'text'],
  ['quoteNumber', '报价编号', '编号信息', 'text'], ['date', '日期', '编号信息', 'text'], ['contactPerson', '联系人', '联系信息', 'text'],
  ['contactPhone', '联系电话', '联系信息', 'text'], ['companyAddress', '公司地址', '联系信息', 'text'], ['attachment', '附件/PDF文件', '附件资料', 'file'],
  ['image', '图片/照片', '附件资料', 'image'], ['notes', '备注', '其他', 'text']
].map(([key, label, category, dataType]) => ({ key, label, category, dataType, isBuiltin: true }));

// 资料归档使用安全、可重复的目录规则：类型 / 日期 / 业务文件夹 / 文件。
// 目录只在实际上传或生成文件时创建，不预先创建空目录。
const localDate = value => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const safeArchivePart = value => String(value || 'unnamed')
  .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 220) || 'unnamed';
const archiveFolderName = (date, title) => `${String(date || localDate()).replace(/-/g, '').slice(4, 8)}-${safeArchivePart(title)}`;
const archiveCategoryLabel = value => {
  const raw = String(value || '').trim();
  const aliases = { rfq: '询价表', quote: '报价/对比表', supplier: '供应商储备', product: '产品代码表', attachment: '任务附件', template: '模板', other: '其他资料' };
  return aliases[raw.toLowerCase()] || raw || '其他资料';
};
const inferArchiveCategory = (fileName, requested) => {
  if (String(requested || '').trim()) return archiveCategoryLabel(requested);
  const name = String(fileName || '').toLowerCase();
  if (/rfq|solicitud|precio|inquiry|询价/.test(name)) return '询价表';
  if (/supplier|vendor|供应商/.test(name)) return '供应商储备';
  if (/product.?code|sku|产品代码|代码表/.test(name)) return '产品代码表';
  if (/template|模板/.test(name)) return '模板';
  return '其他资料';
};
const archiveStoragePath = (root, category, date, folder, name) => path.join(
  root, 'documents', 'archive', safeArchivePart(category), String(date).replace(/-/g, ''),
  safeArchivePart(folder), safeArchivePart(name)
);

async function insertDocument(executor, data) {
  const id = data.id || uuid();
  const timestamp = data.createdAt || now();
  await executor.execute(
    `INSERT INTO documents
      (id, original_name, storage_path, mime_type, file_size, file_ext, category,
       entity_type, entity_id, archive_category, archive_date, archive_folder, archive_name,
       visibility, version_no, checksum, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [id, data.originalName, data.storagePath, data.mimeType || null, Number(data.fileSize || 0),
      data.fileExt || path.extname(data.originalName || '').slice(1).toLowerCase() || null,
      data.category || 'other', data.entityType || null, data.entityId || null,
      data.archiveCategory || null, data.archiveDate || null, data.archiveFolder || null, data.archiveName || data.originalName || null,
      data.visibility || 'all', Number(data.versionNo || 1), data.checksum || null,
      data.createdBy, timestamp, timestamp]
  );
  return id;
}

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

  const sessionSecret = (config.sessionSecret && config.sessionSecret.length >= 16)
    ? config.sessionSecret
    : (config.mysql && config.mysql.password && config.mysql.password.length >= 16
      ? config.mysql.password
      : crypto.randomBytes(32).toString('hex'));

  app.use(session({
    secret: sessionSecret,
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

  const externalRfqLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { message: '外部询价提交过于频繁，请稍后再试' }
  });

  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth/register', loginLimiter);
  app.use('/api/', apiLimiter);
  app.use('/api/external/rfqs', externalRfqLimiter);

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
  app.get('/api/version', (req, res) => res.json({ version: packageVersion }));

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
       (id, username, display_name, password_hash, password_salt, role, status, requested_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'admin', 'active', 'admin', ?, ?)`,
      [id, username.trim(), displayName.trim(), passwordData.hash, passwordData.salt, timestamp, timestamp]
    );
    res.status(201).json({ id, username, displayName, role: 'admin' });
  }));

  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    const { username, displayName, password, department, phone } = req.body || {};
    if (!username || !displayName) return res.status(400).json({ message: '请输入账号和姓名' });
    const registrationToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(registrationToken);
    const safeRole = 'viewer';
    const passwordData = await hashPassword(password);
    const id = uuid();
    const timestamp = now();
    const initialStatus = 'pending';
    try {
      await getPool().execute(
        `INSERT INTO users
         (id, username, display_name, password_hash, password_salt, role, status, requested_role, registration_token_hash, department, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [id, username.trim(), displayName.trim(), passwordData.hash, passwordData.salt, safeRole, initialStatus, tokenHash, department?.trim() || null, phone?.trim() || null, timestamp, timestamp]
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: '该账号已经存在' });
      throw error;
    }
    res.status(201).json({
      id,
      status: initialStatus,
      role: null,
      registrationToken,
      message: '账号创建成功，请继续选择职位。'
    });
  }));

  app.post('/api/auth/register/role', asyncRoute(async (req, res) => {
    const { registrationToken, role, department, phone } = req.body || {};
    if (!registrationToken) return res.status(400).json({ message: '注册流程已失效，请重新注册' });
    const safeRole = normalizeRole(role);
    const [result] = await getPool().execute(
      `UPDATE users SET role = ?, requested_role = ?, department = COALESCE(?, department), phone = COALESCE(?, phone), registration_token_hash = NULL, updated_at = ?
       WHERE registration_token_hash = ? AND status = 'pending'`,
      [safeRole, safeRole, department?.trim() || null, phone?.trim() || null, now(), hashToken(registrationToken)]
    );
    if (!result.affectedRows) return res.status(400).json({ message: '注册流程已失效，请重新注册' });
    res.json({ status: 'pending', role: safeRole, message: '职位申请已提交，请等待负责人审核后登录。' });
  }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    const [[user]] = await getPool().execute('SELECT * FROM users WHERE username = ?', [username || '']);
    if (!user || !(await verifyPassword(password || '', user.password_salt, user.password_hash))) {
      return res.status(401).json({ message: '账号或密码错误' });
    }
    if (user.status !== 'active') return res.status(403).json({ message: '账号尚未启用或已被停用' });
    if (false && !['admin', 'manager'].includes(user.role)) {
      return res.status(403).json({ message: '该账号没有管理权限' });
    }
    if (false && ['admin', 'manager'].includes(user.role)) {
      return res.status(403).json({ message: '请从管理员入口登录' });
    }
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await getPool().execute(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [hashToken(token), user.id, expiresAt, now()]
    );
    req.session.userId = user.id;
    res.cookie('latic_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
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
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || getCookie(req, 'latic_token');
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

  // 海外端只允许提交询价文件，不授予任何数据库或国内任务权限。
  // 密钥从服务器初始化配置中读取，比较时使用 timingSafeEqual 避免明文比较。
  const authenticateExternal = (req, res, next) => {
    const expected = String(config.externalApiKey || '');
    const provided = String(req.headers['x-latic-external-key'] || req.body?.apiKey || '');
    if (!expected || !provided) return res.status(401).json({ message: '缺少外部接收密钥' });
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      return res.status(401).json({ message: '外部接收密钥无效' });
    }
    next();
  };

  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', authenticate, asyncRoute(async (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || getCookie(req, 'latic_token');
    if (token) await getPool().execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    req.session.destroy(() => {});
    res.clearCookie('latic_token');
    res.json({ ok: true });
  }));

  /**
   * 外部询价接收箱：海外端上传 Excel 后只产生一条 received 记录。
   * 管理员调用 /accept 后才会生成国内协作任务和产品明细。
   */
  app.post('/api/external/rfqs', authenticateExternal, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择Excel询价表' });
    const externalRequestId = String(req.body.externalRequestId || '').trim() || null;
    if (externalRequestId) {
      const [[existing]] = await getPool().execute(
        'SELECT id, status, task_id AS taskId FROM external_rfq_submissions WHERE external_request_id = ?',
        [externalRequestId]
      );
      if (existing) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(409).json({ message: '该外部询价编号已经提交过', submission: existing });
      }
    }

    const submissionId = uuid();
    const submissionDir = path.join(config.storageDir, 'external-rfqs', submissionId);
    fs.mkdirSync(submissionDir, { recursive: true });
    const safeOriginalName = path.basename(req.file.originalname || '询价表.xlsx').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const sourcePath = path.join(submissionDir, safeOriginalName);
    fs.renameSync(req.file.path, sourcePath);

    let imported;
    try {
      imported = await importRfqWorkbook(sourcePath);
    } catch (error) {
      try { fs.rmSync(submissionDir, { recursive: true, force: true }); } catch (_) {}
      return res.status(422).json({ message: `无法识别询价表：${error.message}` });
    }

    const metadata = {
      requester: req.body.requester || imported.metadata.requester || null,
      country: req.body.country || imported.metadata.country || null,
      client: req.body.client || imported.metadata.client || null,
      requestDate: req.body.requestDate || imported.metadata.requestDate || null,
      deadline: req.body.deadline || null,
      sheetName: imported.sheetName,
      headerRow: imported.headerRow,
      tableCount: imported.tableCount,
      tables: imported.tables,
      sourceChannel: 'external'
    };
    await getPool().execute(
      `INSERT INTO external_rfq_submissions
       (id, external_request_id, title, requester, country, client_name, request_date, deadline,
        original_name, storage_path, metadata_json, parsed_items_json, status, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
      [submissionId, externalRequestId,
        String(req.body.title || safeOriginalName.replace(/\.xlsx$/i, '')),
        metadata.requester, metadata.country, metadata.client, metadata.requestDate, metadata.deadline,
        safeOriginalName, sourcePath, json(metadata), json(imported.items), now()]
    );
    res.status(201).json({
      id: submissionId,
      externalRequestId,
      status: 'received',
      title: String(req.body.title || safeOriginalName.replace(/\.xlsx$/i, '')),
      itemCount: imported.items.length,
      message: '询价表已送达国内接收箱，等待管理员下发'
    });
  }));

  app.get('/api/external/rfqs', authenticate, asyncRoute(async (req, res) => {
    const ownOnly = req.user.role === 'viewer';
    const [rows] = await getPool().execute(
      `SELECT e.id, e.external_request_id AS externalRequestId, e.title, e.requester, e.country,
              e.client_name AS clientName, e.request_date AS requestDate, e.deadline,
              e.original_name AS originalName, e.status, e.received_at AS receivedAt,
              e.reviewed_at AS reviewedAt, e.reviewed_by AS reviewedBy, e.task_id AS taskId,
              e.rejection_reason AS rejectionReason, e.parsed_items_json AS parsedItems,
              t.status AS taskStatus
       FROM external_rfq_submissions e LEFT JOIN rfq_tasks t ON t.id = e.task_id
       ${ownOnly ? 'WHERE e.created_by = ?' : ''} ORDER BY e.received_at DESC LIMIT 200`,
      ownOnly ? [req.user.id] : []
    );
    res.json({ submissions: rows.map(row => ({
      ...row,
      itemCount: parseJson(row.parsedItems, []).length,
      parsedItems: undefined
    })) });
  }));

  app.post('/api/external/rfqs/:id/reject', authenticate, requireRole('manager'), asyncRoute(async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    const result = await getPool().execute(
      `UPDATE external_rfq_submissions SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, reviewed_by = ?
       WHERE id = ? AND status = 'received'`,
      [reason || null, now(), req.user.id, req.params.id]
    );
    if (!result[0].affectedRows) return res.status(404).json({ message: '待接收询价不存在或已经处理' });
    res.json({ ok: true, status: 'rejected' });
  }));

  app.post('/api/external/rfqs/:id/accept', authenticate, requireRole('manager'), asyncRoute(async (req, res) => {
    const [[submission]] = await getPool().execute(
      'SELECT * FROM external_rfq_submissions WHERE id = ? AND status = \'received\'', [req.params.id]
    );
    if (!submission) return res.status(404).json({ message: '待接收询价不存在或已经处理' });
    const items = parseJson(submission.parsed_items_json, []);
    const metadata = parseJson(submission.metadata_json, {});
    const taskId = uuid();
    const taskDir = path.join(config.storageDir, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const sourcePath = path.join(taskDir, submission.original_name);
    fs.copyFileSync(submission.storage_path, sourcePath);
    const taskNo = String(req.body?.taskNo || `RFQ-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-4)}`);
    const title = String(req.body?.title || submission.title);
    const timestamp = now();
    await withTransaction(async connection => {
      await connection.execute(
        `INSERT INTO rfq_tasks
         (id, task_no, title, requester, country, client_name, request_date, deadline,
          import_type, delivery_type, payment_type, status, source_original_name,
          source_storage_path, assigned_user_ids, metadata_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`,
        [taskId, taskNo, title, submission.requester, submission.country, submission.client_name,
          submission.request_date, req.body?.deadline || submission.deadline || null,
          metadata.importType || null, metadata.deliveryType || null, metadata.paymentType || null,
          submission.original_name, sourcePath, json(parseJson(req.body?.assignedUserIds, [])),
          json({ ...metadata, sourceChannel: 'external', submissionId: submission.id, externalRequestId: submission.external_request_id }),
          req.user.id, timestamp, timestamp]
      );
      for (const item of items) {
        await connection.execute(
          `INSERT INTO rfq_items
           (id, task_id, line_no, description, quantity, unit, product_code, ltc, remarks,
            attachments_json, source_json, row_version, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 1, ?, ?, ?)`,
          [uuid(), taskId, item.lineNo, item.description || '', item.quantity || null, item.unit || null,
            item.code || null, item.ltc || null, item.observation || null, json(item.source || item),
            req.user.id, timestamp, timestamp]
        );
      }
      await insertDocument(connection, {
        originalName: submission.original_name,
        storagePath: sourcePath,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: fs.statSync(sourcePath).size,
        category: 'rfq', entityType: 'rfq_task', entityId: taskId,
        createdBy: req.user.id, visibility: 'all'
      });
      await createNotifications(connection, taskId, '收到新询价任务', `${title}，共 ${items.length} 项产品`);
      await connection.execute(
        `UPDATE external_rfq_submissions SET status = 'accepted', reviewed_at = ?, reviewed_by = ?, task_id = ? WHERE id = ?`,
        [timestamp, req.user.id, taskId, submission.id]
      );
      await connection.execute(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id, created_at)
         VALUES ('task', ?, 'external_accept', ?, ?, ?)`,
        [taskId, json({ taskNo, title, itemCount: items.length, submissionId: submission.id }), req.user.id, timestamp]
      );
    });
    res.status(201).json({ id: taskId, taskNo, title, itemCount: items.length, status: 'published' });
  }));

  app.get('/api/external/rfqs/:id/result', authenticate, asyncRoute(async (req, res) => {
    const ownershipClause = req.user.role === 'viewer' ? 'AND e.created_by = ?' : '';
    const params = req.user.role === 'viewer' ? [req.params.id, req.user.id] : [req.params.id];
    const [[record]] = await getPool().execute(
      `SELECT e.title, e.original_name AS originalName, e.task_id AS taskId,
              t.status AS taskStatus, t.source_storage_path AS sourcePath
       FROM external_rfq_submissions e JOIN rfq_tasks t ON t.id = e.task_id
       WHERE e.id = ? ${ownershipClause}`,
      params
    );
    if (!record) return res.status(404).json({ message: '询价单或审核结果不存在' });
    if (!['submitted', 'completed'].includes(record.taskStatus)) {
      return res.status(409).json({ message: '询价结果尚未通过总经理审核' });
    }
    if (!record.sourcePath || !fs.existsSync(record.sourcePath)) {
      return res.status(404).json({ message: '原始询价单文件不存在' });
    }
    const [items] = await getPool().execute(
      `SELECT line_no AS lineNo, fob_usd AS fobUsd, total_rmb AS totalRmb, remarks,
              attachments_json AS attachments, source_json AS source
       FROM rfq_items WHERE task_id = ? ORDER BY line_no`,
      [record.taskId]
    );
    const outputDir = path.join(config.storageDir, 'tasks', record.taskId, 'exports');
    fs.mkdirSync(outputDir, { recursive: true });
    const baseName = path.basename(record.originalName || '询价单.xlsx').replace(/\.xlsx$/i, '');
    const downloadName = `已审核_${baseName}.xlsx`;
    const outputPath = path.join(outputDir, `${Date.now()}-${downloadName}`);
    await exportCompletedRfq(record.sourcePath, outputPath, items.map(item => ({
      ...item,
      attachments: parseJson(item.attachments, []),
      source: parseJson(item.source, {})
    })));
    res.download(outputPath, downloadName);
  }));

  app.get('/api/users', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const [rows] = await getPool().query(
       `SELECT id, username, display_name AS displayName, role, requested_role AS requestedRole, department, phone, language, status, created_at AS createdAt
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
  app.patch('/api/users/:id/role', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const role = ['admin', 'manager', 'purchaser', 'viewer'].includes(req.body?.role) ? req.body.role : null;
    if (!role) return res.status(400).json({ message: '无效的角色，可选：admin, manager, purchaser, viewer' });
    await getPool().execute('UPDATE users SET role = ?, requested_role = ?, updated_at = ? WHERE id = ?', [role, role, now(), req.params.id]);
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
  app.get('/api/templates/shared', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      `SELECT t.id, t.name, t.type, t.description, t.structure_json AS structure, t.mappings_json AS mappings,
              u.display_name AS ownerName, t.updated_at AS updatedAt
       FROM user_templates t JOIN users u ON u.id = t.owner_id
       WHERE t.is_shared = 1 AND t.owner_id != ? ORDER BY t.updated_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(r => ({ ...r, structure: parseJson(r.structure), mappings: parseJson(r.mappings) })));
  }));
  app.post('/api/templates', authenticate, asyncRoute(async (req, res) => {
    const id = req.body.id || uuid();
    const timestamp = now();
    const template = req.body || {};
    if (!template.name) return res.status(400).json({ message: '模板名称不能为空' });
    const isShared = template.isShared != null ? (template.isShared ? 1 : 0) : 0;
    await getPool().execute(
      `INSERT INTO user_templates
       (id, owner_id, name, type, description, original_name, structure_json, mappings_json, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), is_shared = VALUES(is_shared), updated_at = VALUES(updated_at)`,
      [id, req.user.id, template.name, template.type || '通用', template.description || null,
        template.originalName || null, json(template.structure), json(template.mappings || []),
        isShared, id === req.body.id ? undefined : timestamp, timestamp]
    );
    res.status(201).json({ id });
  }));

  async function createNotifications(connection, taskId, title, message) {
    const [users] = await connection.query("SELECT id FROM users WHERE status = 'active' AND role = 'manager'");
    for (const user of users) {
      await connection.execute(
        `INSERT INTO notifications (id, user_id, type, title, message, task_id, is_read, created_at)
         VALUES (?, ?, 'task', ?, ?, ?, 0, ?)`,
        [uuid(), user.id, title, message, taskId, now()]
      );
    }
  }

  app.post('/api/tasks/import', authenticate, requireRole('manager'), upload.single('file'), asyncRoute(async (req, res) => {
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
    const archiveDate = localDate(imported.metadata.requestDate || timestamp);
    const archiveFolder = archiveFolderName(archiveDate, title);
    const archiveSourcePath = archiveStoragePath(config.storageDir, '询价表', archiveDate, archiveFolder, safeOriginalName);
    fs.mkdirSync(path.dirname(archiveSourcePath), { recursive: true });
    fs.copyFileSync(sourcePath, archiveSourcePath);
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
          json(parseJson(req.body.assignedUserIds, [])), json({ sheetName: imported.sheetName, headerRow: imported.headerRow, tableCount: imported.tableCount, tables: imported.tables }),
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
      await insertDocument(connection, {
        originalName: safeOriginalName, storagePath: archiveSourcePath,
        mimeType: req.file.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: fs.statSync(sourcePath).size, category: '询价表', entityType: 'rfq_task',
        entityId: taskId, archiveCategory: '询价表',
        archiveDate, archiveFolder,
        archiveName: safeOriginalName, createdBy: req.user.id, visibility: 'all'
      });
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
              SUM(CASE WHEN i.fob_usd IS NOT NULL THEN 1 ELSE 0 END) AS completedCount,
              MAX(CASE WHEN i.assigned_user_id = ? THEN 1 ELSE 0 END) AS itemAssigned
       FROM rfq_tasks t LEFT JOIN rfq_items i ON i.task_id = t.id
       GROUP BY t.id ORDER BY t.updated_at DESC`,
      [req.user.id]
    );
    const visibleRows = req.user.role === 'viewer' ? []
      : req.user.role === 'purchaser' ? rows.filter(row => Number(row.itemAssigned) === 1)
        : req.user.role === 'admin' ? rows.filter(row => ['review', 'submitted', 'completed'].includes(row.status))
          : rows;
    res.json({ tasks: visibleRows.map(row => ({
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

  app.get('/api/search', authenticate, asyncRoute(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ tasks: [], items: [] });
    const like = `%${q}%`;
    const [taskRows] = await getPool().execute(
      'SELECT id, task_no AS taskNo, title, status FROM rfq_tasks WHERE title LIKE ? OR task_no LIKE ? OR requester LIKE ? LIMIT 20',
      [like, like, like]
    );
    const [itemRows] = await getPool().execute(
      `SELECT i.id, i.task_id AS taskId, i.line_no AS lineNo, i.description, i.selected_supplier AS supplier,
              t.title AS taskTitle, t.task_no AS taskNo
       FROM rfq_items i JOIN rfq_tasks t ON t.id = i.task_id
       WHERE i.description LIKE ? OR i.product_code LIKE ? OR i.selected_supplier LIKE ?
       LIMIT 20`,
      [like, like, like]
    );
    res.json({ tasks: taskRows, items: itemRows });
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
    if (req.user.role === 'viewer') return res.status(403).json({ message: '海外业务员不参与国内询价任务' });
    if (req.user.role === 'admin' && !['review', 'submitted', 'completed'].includes(task.status)) {
      return res.status(403).json({ message: '该询价单尚未提交总经理审核' });
    }
    const [items] = await getPool().execute(
      `SELECT i.id, i.line_no AS lineNo, i.description, i.quantity, i.unit,
              i.product_code AS productCode, i.ltc, i.fob_usd AS fobUsd,
              i.total_usd AS totalUsd, i.total_rmb AS totalRmb,
              i.exchange_rate AS exchangeRate, i.invoice_type AS invoiceType,
              i.selected_supplier AS selectedSupplier, i.selected_quote_json AS selectedQuote,
              i.remarks, i.attachments_json AS attachments,
              i.source_json AS source, i.row_version AS rowVersion,
              i.assigned_user_id AS assignedUserId, au.display_name AS assignedUserName,
              i.updated_at AS updatedAt, u.display_name AS updatedByName
       FROM rfq_items i LEFT JOIN users u ON u.id = i.updated_by
       LEFT JOIN users au ON au.id = i.assigned_user_id
       WHERE i.task_id = ? ORDER BY i.line_no`,
      [req.params.id]
    );
    if (req.user.role === 'purchaser' && !items.some(item => item.assignedUserId === req.user.id)) {
      return res.status(403).json({ message: '该询价单没有分配给你负责的产品' });
    }
    task.assignedUserIds = parseJson(task.assignedUserIds, []);
    const visibleItems = req.user.role === 'purchaser'
      ? items.filter(item => item.assignedUserId === req.user.id)
      : items;
    res.json({ task, items: visibleItems.map(item => ({
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

  app.get('/api/tasks/:id/export', authenticate, requireRole('admin', 'manager', 'purchaser'), asyncRoute(async (req, res) => {
    const [[task]] = await getPool().execute(
      'SELECT id, title, request_date, created_at, source_original_name, source_storage_path FROM rfq_tasks WHERE id = ?',
      [req.params.id]
    );
    if (!task || !task.source_storage_path || !fs.existsSync(task.source_storage_path)) {
      return res.status(404).json({ message: '原始询价单文件不存在' });
    }
    const [items] = await getPool().execute(
      `SELECT line_no AS lineNo, fob_usd AS fobUsd, total_rmb AS totalRmb, remarks,
              attachments_json AS attachments, source_json AS source
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
      attachments: parseJson(item.attachments, []),
      source: parseJson(item.source, {})
    })));
    await insertDocument(getPool(), {
      originalName: downloadName, storagePath: outputPath,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: fs.statSync(outputPath).size, category: '询价表', entityType: 'rfq_task',
      entityId: task.id, archiveCategory: '询价表',
      archiveDate: localDate(task.request_date || task.created_at),
      archiveFolder: archiveFolderName(localDate(task.request_date || task.created_at), task.title),
      archiveName: downloadName, createdBy: req.user.id, visibility: 'all'
    });
    await getPool().execute(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id, created_at)
       VALUES ('task', ?, 'export', ?, ?, ?)`,
      [task.id, json({ fileName: downloadName, itemCount: items.length }), req.user.id, now()]
    );
    res.download(outputPath, downloadName);
  }));

  app.patch('/api/tasks/:taskId/items/:itemId/assignee', authenticate, requireRole('manager'), asyncRoute(async (req, res) => {
    const assignedUserId = req.body?.assignedUserId || null;
    if (assignedUserId) {
      const [[assignee]] = await getPool().execute(
        "SELECT id, display_name AS displayName FROM users WHERE id = ? AND status = 'active' AND role = 'purchaser'",
        [assignedUserId]
      );
      if (!assignee) return res.status(400).json({ message: '只能分配给已启用的采购专员' });
    }
    const [result] = await getPool().execute(
      'UPDATE rfq_items SET assigned_user_id = ?, updated_by = ?, updated_at = ? WHERE id = ? AND task_id = ?',
      [assignedUserId, req.user.id, now(), req.params.itemId, req.params.taskId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: '产品明细不存在' });
    if (assignedUserId) {
      await getPool().execute(
        `INSERT INTO notifications (id, user_id, type, title, message, task_id, is_read, created_at)
         VALUES (?, ?, 'assignment', '收到产品询价任务', '主管已分配一项产品给你', ?, 0, ?)`,
        [uuid(), assignedUserId, req.params.taskId, now()]
      );
    }
    res.json({ ok: true, assignedUserId });
  }));

  app.patch('/api/tasks/:taskId/items/:itemId', authenticate, asyncRoute(async (req, res) => {
    const expectedVersion = Number(req.body?.rowVersion);
    const result = await withTransaction(async connection => {
      const [[current]] = await connection.execute(
        'SELECT * FROM rfq_items WHERE id = ? AND task_id = ? FOR UPDATE',
        [req.params.itemId, req.params.taskId]
      );
      if (!current) return { notFound: true };
      if (req.user.role === 'viewer' || (req.user.role === 'purchaser' && current.assigned_user_id !== req.user.id)) {
        return { forbidden: true };
      }
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
    if (result.forbidden) return res.status(403).json({ message: '该产品没有分配给你' });
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
    await insertDocument(getPool(), {
      originalName: safeName, storagePath: targetPath, mimeType: req.file.mimetype,
      fileSize: req.file.size, category: 'attachment', entityType: 'rfq_item',
      entityId: req.params.itemId, createdBy: req.user.id, visibility: 'all'
    });
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
    const [reviewers] = await getPool().query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
    for (const reviewer of reviewers) {
      await getPool().execute(
        `INSERT INTO notifications (id, user_id, type, title, message, task_id, is_read, created_at)
         VALUES (?, ?, 'review', '询价任务等待审核', ?, ?, 0, ?)`,
        [uuid(), reviewer.id, `${req.user.displayName}提交了任务`, req.params.id, now()]
      );
    }
    res.json({ ok: true });
  }));

  app.post('/api/tasks/:id/snapshots', authenticate, requireRole('admin'), asyncRoute(async (req, res) => {
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
    const [[external]] = await getPool().execute(
      'SELECT created_by AS createdBy, title FROM external_rfq_submissions WHERE task_id = ?',
      [req.params.id]
    );
    if (external?.createdBy) {
      await getPool().execute(
        `INSERT INTO notifications (id, user_id, type, title, message, task_id, is_read, created_at)
         VALUES (?, ?, 'rfq_result', '询价结果已通过审核', ?, ?, 0, ?)`,
        [uuid(), external.createdBy, `${external.title} 已可下载`, req.params.id, now()]
      );
    }
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
    const { structure, fields } = await parseTemplateStructure(storagePath);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    const timestamp = now();
    const originalName = decodeUploadedName(req.file.originalname || 'template.xlsx');
    const name = decodeUploadedName(req.body.name || path.basename(originalName, path.extname(originalName))) || '未命名模板';
    const [customFieldRows] = await getPool().query(
      'SELECT field_key AS `key`, label, category, data_type AS dataType FROM custom_system_fields'
    );
    const availableSystemFields = [...BUILTIN_SYSTEM_FIELDS, ...customFieldRows];
    const inferredMappings = fields.map(templateField => ({
      templateField,
      systemField: inferSystemFieldKey(templateField, availableSystemFields, { allowUnknown: false })
    })).filter(mapping => mapping.systemField);
    await getPool().execute(
      `INSERT INTO user_templates (id, owner_id, name, type, description, original_name, structure_json, mappings_json, is_shared, storage_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, name, req.body.type || '通用', req.body.description || null, originalName,
       json(structure), json(inferredMappings), 0, storagePath, timestamp, timestamp]
    );
    res.json({ id, name, fields, structure });
  }));
  app.post('/api/excel/open-existing', authenticate, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择Excel文件' });
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(req.file.path);
      const sheet = workbook.getWorksheet(1);
      if (!sheet) return res.status(400).json({ message: '文件中没有找到工作表' });
      const batches = [];
      let currentCategory = '';
      let currentItems = [];
      let templateId = req.body.templateId || null;
      let detectedHeaderRow = 1;
      // 查找表头行和隐藏元数据
      for (let r = 1; r <= Math.min(50, sheet.rowCount); r++) {
        const row = sheet.getRow(r);
        const firstVal = String(row.getCell(1).value || '').trim();
        if (firstVal.startsWith('{{') && firstVal.endsWith('}}')) {
          detectedHeaderRow = r;
          break;
        }
      }
      for (let r = detectedHeaderRow + 1; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        const firstVal = String(row.getCell(1).value || '').trim();
        if (firstVal && !row.getCell(2).value && row.getCell(1).font && row.getCell(1).font.bold) {
          if (currentItems.length) { batches.push({ category: currentCategory, items: currentItems }); }
          currentCategory = firstVal;
          currentItems = [];
        } else if (firstVal || row.getCell(2).value) {
          const item = {};
          row.eachCell({ includeEmpty: false }, (cell, colNum) => {
            item[`col_${colNum}`] = cell.value;
          });
          currentItems.push(item);
        }
      }
      if (currentItems.length) batches.push({ category: currentCategory, items: currentItems });
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.json({ success: true, templateId: templateId || null, batches: batches.length ? batches : [{ category: '', items: [] }] });
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      throw e;
    }
  }));
  app.post('/api/excel/generate', authenticate, asyncRoute(async (req, res) => {
    const { templateId, batches, options } = req.body || {};
    if (!templateId) return res.status(400).json({ message: '请先选择模板' });
    const generatedPath = await generateExcel(templateId, batches, options);
    const downloadName = path.basename(String(req.body.fileName || req.body.savePath || `generated_${localDate()}.xlsx`)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const archiveDate = localDate(req.body.archiveDate || now());
    const archiveCategory = inferArchiveCategory(downloadName, req.body.archiveCategory || 'quote');
    const archiveFolder = archiveFolderName(archiveDate, req.body.archiveFolder || downloadName.replace(/\.xlsx$/i, ''));
    const outputPath = archiveStoragePath(config.storageDir, archiveCategory, archiveDate, archiveFolder, downloadName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(generatedPath, outputPath);
    try { fs.unlinkSync(generatedPath); } catch (_) {}
    await insertDocument(getPool(), {
      originalName: downloadName, storagePath: outputPath,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: fs.statSync(outputPath).size, category: archiveCategory,
      archiveCategory, archiveDate, archiveFolder, archiveName: downloadName,
      entityType: 'generated_excel', createdBy: req.user.id, visibility: 'all'
    });
    res.download(outputPath, downloadName);
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
    const custom = rows.map(row => ({ ...row, isBuiltin: false, isCustom: true }));
    const keys = new Set(custom.map(row => row.key));
    res.json({ fields: [...BUILTIN_SYSTEM_FIELDS.filter(field => !keys.has(field.key)).map(field => ({ ...field, isCustom: false })), ...custom] });
  }));

  // Signed-in overseas staff submit from the web page. Their account is recorded
  // so that the same user can later see the returned result without domestic access.
  app.post('/api/external/rfqs/submit', authenticate, requireRole('viewer'), upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择 Excel 询价表' });
    const submissionId = uuid();
    const submissionDir = path.join(config.storageDir, 'external-rfqs', submissionId);
    fs.mkdirSync(submissionDir, { recursive: true });
    const decodedName = decodeUploadedName(req.file.originalname || '询价表.xlsx');
    const safeOriginalName = path.basename(decodedName).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const sourcePath = path.join(submissionDir, safeOriginalName);
    fs.renameSync(req.file.path, sourcePath);
    let imported;
    try {
      imported = await importRfqWorkbook(sourcePath);
    } catch (error) {
      try { fs.rmSync(submissionDir, { recursive: true, force: true }); } catch (_) {}
      return res.status(422).json({ message: `无法识别询价表：${error.message}` });
    }
    const metadata = {
      requester: req.body.requester || req.user.displayName,
      country: req.body.country || imported.metadata.country || null,
      client: req.body.client || imported.metadata.client || null,
      requestDate: req.body.requestDate || imported.metadata.requestDate || null,
      deadline: req.body.deadline || null,
      sheetName: imported.sheetName,
      headerRow: imported.headerRow,
      tableCount: imported.tableCount,
      tables: imported.tables,
      sourceChannel: 'overseas_web'
    };
    const title = String(req.body.title || safeOriginalName.replace(/\.(?:xlsx|xls)$/i, ''));
    await getPool().execute(
      `INSERT INTO external_rfq_submissions
       (id, title, requester, country, client_name, request_date, deadline, original_name,
        storage_path, metadata_json, parsed_items_json, status, created_by, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
      [submissionId, title, metadata.requester, metadata.country, metadata.client,
        metadata.requestDate, metadata.deadline, safeOriginalName, sourcePath,
        json(metadata), json(imported.items), req.user.id, now()]
    );
    const [managers] = await getPool().query("SELECT id FROM users WHERE role = 'manager' AND status = 'active'");
    for (const manager of managers) {
      await getPool().execute(
        `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
         VALUES (?, ?, 'external_rfq', '收到海外询价单', ?, 0, ?)`,
        [uuid(), manager.id, `${title}，共 ${imported.items.length} 项产品`, now()]
      );
    }
    res.status(201).json({ id: submissionId, title, itemCount: imported.items.length, status: 'received' });
  }));
  app.post('/api/fields', authenticate, asyncRoute(async (req, res) => {
    const { key: requestedKey, label, category, dataType } = req.body || {};
    if (!label) return res.status(400).json({ message: '字段名称不能为空' });
    const baseKey = String(requestedKey || label).trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || `custom_${Date.now()}`;
    let key = baseKey;
    let suffix = 2;
    while (BUILTIN_SYSTEM_FIELDS.some(field => field.key === key)) key = `${baseKey}_${suffix++}`;
    await getPool().execute(
      'INSERT INTO custom_system_fields (field_key, label, category, data_type, created_by, created_at) VALUES (?,?,?,?,?,?)',
      [key, label, category || '自定义', dataType || 'text', req.user.id, now()]
    );
    res.status(201).json({ ok: true, field: { key, label, category: category || '自定义', dataType: dataType || 'text', isBuiltin: false, isCustom: true } });
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
    res.json(await getToday(req.query.force === '1'));
  }));

  // 资料中心：用户通过页面访问，数据库和物理文件路径不直接暴露给客户端。
  app.get('/api/documents', authenticate, asyncRoute(async (req, res) => {
    const page = Math.max(0, Number.parseInt(req.query.page, 10) || 0);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(req.query.pageSize, 10) || 30));
    const query = String(req.query.query || '').trim();
    const category = String(req.query.category || '').trim();
    const where = ["d.status = 'active'", "(d.visibility = 'all' OR d.created_by = ? OR ? IN ('admin','manager'))"];
    const params = [req.user.id, req.user.role];
    if (query) { where.push('(d.original_name LIKE ? OR d.entity_type LIKE ?)'); params.push(`%${query}%`, `%${query}%`); }
    if (category && category !== 'all') { where.push('(d.category = ? OR d.archive_category = ?)'); params.push(category, category); }
    const [rows] = await getPool().execute(
      `SELECT d.id, d.original_name AS originalName, d.mime_type AS mimeType, d.file_size AS fileSize,
              d.file_ext AS fileExt, d.category, d.entity_type AS entityType, d.entity_id AS entityId,
              d.archive_category AS archiveCategory, d.archive_date AS archiveDate,
              d.archive_folder AS archiveFolder, d.archive_name AS archiveName,
              d.visibility, d.version_no AS versionNo, d.created_at AS createdAt,
              u.display_name AS createdByName
       FROM documents d JOIN users u ON u.id = d.created_by
       WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ${pageSize} OFFSET ${page * pageSize}`,
      params
    );
    const [[countRow]] = await getPool().execute(`SELECT COUNT(*) AS total FROM documents d WHERE ${where.join(' AND ')}`, params);
    res.json({ documents: rows.map(row => ({ ...row, fileSize: Number(row.fileSize || 0), versionNo: Number(row.versionNo || 1) })), total: Number(countRow.total || 0), page, pageSize });
  }));

  app.post('/api/documents', authenticate, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择要归档的文件' });
    const documentId = uuid();
    const archiveDate = localDate(req.body.archiveDate || now());
    const archiveCategory = inferArchiveCategory(req.file.originalname, req.body.archiveCategory || req.body.category);
    const archiveFolder = archiveFolderName(archiveDate, req.body.archiveFolder || req.file.originalname);
    const safeName = path.basename(req.file.originalname || '资料').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const targetPath = archiveStoragePath(config.storageDir, archiveCategory, archiveDate, archiveFolder, safeName);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.renameSync(req.file.path, targetPath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
    await insertDocument(getPool(), {
      id: documentId, originalName: safeName, storagePath: targetPath, mimeType: req.file.mimetype,
      fileSize: req.file.size, category: archiveCategory,
      archiveCategory, archiveDate, archiveFolder, archiveName: safeName,
      entityType: String(req.body.entityType || '') || null, entityId: String(req.body.entityId || '') || null,
      visibility: ['all', 'private', 'department', 'admin'].includes(req.body.visibility) ? req.body.visibility : 'all',
      checksum: hash, createdBy: req.user.id
    });
    res.status(201).json({ id: documentId, originalName: safeName, category: archiveCategory, archiveCategory, archiveDate, archiveFolder });
  }));

  app.get('/api/documents/:id/download', authenticate, asyncRoute(async (req, res) => {
    const [[document]] = await getPool().execute(
      `SELECT d.*, u.display_name AS createdByName FROM documents d JOIN users u ON u.id = d.created_by
       WHERE d.id = ? AND d.status = 'active'`, [req.params.id]
    );
    if (!document || (document.visibility !== 'all' && document.created_by !== req.user.id && !['admin', 'manager'].includes(req.user.role))) {
      return res.status(404).json({ message: '资料不存在或无权访问' });
    }
    if (!document.storage_path || !fs.existsSync(document.storage_path)) return res.status(404).json({ message: '文件本体不存在' });
    res.download(document.storage_path, document.original_name);
  }));

  app.delete('/api/documents/:id', authenticate, asyncRoute(async (req, res) => {
    const [[document]] = await getPool().execute('SELECT id, storage_path, created_by FROM documents WHERE id = ? AND status = \'active\'', [req.params.id]);
    if (!document) return res.status(404).json({ message: '资料不存在' });
    if (document.created_by !== req.user.id && !['admin', 'manager', 'purchaser'].includes(req.user.role)) return res.status(403).json({ message: '无权删除此资料' });
    await getPool().execute('UPDATE documents SET status = \'deleted\', deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), req.params.id]);
    res.json({ ok: true });
  }));

  app.get('/api/tasks/:id/comments', authenticate, asyncRoute(async (req, res) => {
    const [rows] = await getPool().execute(
      `SELECT c.id, c.content, c.created_at AS createdAt, u.display_name AS userName
       FROM task_comments c JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({ comments: rows });
  }));
  app.post('/api/tasks/:id/comments', authenticate, asyncRoute(async (req, res) => {
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ message: '评论不能为空' });
    const id = uuid();
    await getPool().execute(
      'INSERT INTO task_comments (id, task_id, user_id, content, created_at) VALUES (?,?,?,?,?)',
      [id, req.params.id, req.user.id, content, now()]
    );
    res.status(201).json({ id, content, userName: req.user.displayName, createdAt: now().toISOString() });
  }));

  app.get('/api/db/tables', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const [tables] = await getPool().query(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS rowCount
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    res.json(tables.map(t => ({ name: t.name, rowCount: Number(t.rowCount || 0) })));
  }));
  app.get('/api/db/table/:name', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const page = parseInt(req.query.page) || 0;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 100, 1000);
    const [columns] = await getPool().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [req.params.name]
    );
    const colNames = columns.map(c => c.COLUMN_NAME);
    const [[{ count }]] = await getPool().query(`SELECT COUNT(*) AS count FROM \`${req.params.name}\``);
    const offset = page * pageSize;
    const [rows] = await getPool().query(
      `SELECT * FROM \`${req.params.name}\` LIMIT ${pageSize} OFFSET ${offset}`
    );
    res.json({ columns: colNames, rows, total: Number(count) });
  }));
  app.post('/api/db/query', authenticate, requireRole('admin', 'manager'), asyncRoute(async (req, res) => {
    const sql = (req.body.query || '').trim();
    if (!/^\s*SELECT/i.test(sql)) return res.status(400).json({ message: '仅支持 SELECT 查询' });
    const [rows] = await getPool().query(sql);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    res.json({ columns, rows, total: rows.length });
  }));

  const frontendDir = path.join(__dirname, '..', 'dist', 'renderer');
  const API_INIT_JS = require('fs').readFileSync(
    path.join(__dirname, 'api-init-compact.js'), 'utf8'
  );
  if (fs.existsSync(frontendDir)) {
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
