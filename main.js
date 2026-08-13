const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { initDatabase, getDatabase } = require('./src/main/database');
const {
  getBackupsDir,
  listDatabaseBackups,
  createDatabaseBackup,
  createAutomaticBackupIfNeeded,
  restoreDatabaseBackup
} = require('./src/main/databaseMaintenance');
const { ExcelEngine } = require('./src/main/excelEngine');
const { TemplateFileManager } = require('./src/main/templateManager');
const { ExchangeRateService } = require('./src/main/exchangeRateService');
const { RfqManager } = require('./src/main/rfqManager');
const { CollaborationClient } = require('./src/main/collaborationClient');
const { startEmbeddedServerIfConfigured } = require('./server/embedded');
const {
  listSystemFields,
  addCustomSystemField,
  deleteCustomSystemField
} = require('./src/main/systemFields');
const {
  initializeUpdateManager,
  registerUpdateIpcHandlers,
  scheduleAutomaticUpdateCheck
} = require('./src/main/updateManager');

// 部分 Windows 显卡驱动在窗口首次缩放与透明度动画叠加时会留下黑色残影。
// 此应用没有依赖 GPU 的重型渲染，关闭硬件加速可换取更稳定的首次绘制。
app.disableHardwareAcceleration();

let mainWindow;
let excelEngine;
let templateManager;
let exchangeRateService;
let rfqManager;
let collaborationClient;

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: '智能Excel表格生成器',
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'));
  initializeUpdateManager(mainWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    scheduleAutomaticUpdateCheck(1000);
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.excel-template-generator.app');
  initDatabase();
  createAutomaticBackupIfNeeded();
  // 用户数据放在系统提供的独立目录，更新应用不会覆盖，也不会打包给其他用户。
  templateManager = new TemplateFileManager(path.join(app.getPath('userData'), 'templates'));
  excelEngine = new ExcelEngine(getDatabase(), templateManager);
  exchangeRateService = new ExchangeRateService(app.getPath('userData'));
  rfqManager = new RfqManager(
    getDatabase,
    path.join(app.getPath('userData'), 'rfq-sources')
  );
  collaborationClient = new CollaborationClient();
  try {
    await startEmbeddedServerIfConfigured();
  } catch (error) {
    console.error('内置协作服务启动失败：', error.message);
  }
  
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpcHandlers() {
  registerUpdateIpcHandlers();

  // ========== 局域网协作 ==========
  ipcMain.handle('collaboration:getState', async () => collaborationClient.getState());
  ipcMain.handle('collaboration:configure', async (event, serverUrl) => {
    return collaborationClient.configure(serverUrl);
  });
  ipcMain.handle('collaboration:restoreSession', async () => collaborationClient.restoreSession());
  ipcMain.handle('collaboration:setupAdmin', async (event, payload) => {
    return collaborationClient.setupAdmin(payload);
  });
  ipcMain.handle('collaboration:register', async (event, payload) => {
    return collaborationClient.register(payload);
  });
  ipcMain.handle('collaboration:registerRole', async (event, payload) => {
    return collaborationClient.registerRole(payload);
  });
  ipcMain.handle('collaboration:login', async (event, payload) => {
    return collaborationClient.login(payload);
  });
  ipcMain.handle('collaboration:logout', async () => collaborationClient.logout());
  ipcMain.handle('collaboration:getRememberedLogin', async () => collaborationClient.getRememberedLogin());
  ipcMain.handle('collaboration:clearRememberedLogin', async () => collaborationClient.clearRememberedLogin());
  ipcMain.handle('collaboration:listUsers', async () => {
    return collaborationClient.request('/api/users');
  });
  ipcMain.handle('collaboration:updateUserStatus', async (event, userId, status) => {
    return collaborationClient.request(`/api/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH', body: { status }
    });
  });
  ipcMain.handle('collaboration:updateUserRole', async (event, userId, role) => {
    return collaborationClient.request(`/api/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH', body: { role }
    });
  });
  ipcMain.handle('collaboration:listRemoteTemplates', async () => {
    return collaborationClient.request('/api/templates');
  });
  ipcMain.handle('collaboration:saveRemoteTemplate', async (event, template) => {
    return collaborationClient.request('/api/templates', { method: 'POST', body: template });
  });
  ipcMain.handle('collaboration:listTasks', async () => {
    return collaborationClient.request('/api/tasks');
  });
  ipcMain.handle('collaboration:getTask', async (event, taskId) => {
    return collaborationClient.request(`/api/tasks/${encodeURIComponent(taskId)}`);
  });
  ipcMain.handle('collaboration:importTask', async (event, metadata = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择上级下发的Excel询价单',
      filters: [{ name: 'Excel询价单', extensions: ['xlsx'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return collaborationClient.importTask(result.filePaths[0], metadata);
  });
  ipcMain.handle('collaboration:listExternalSubmissions', async () => collaborationClient.listExternalSubmissions());
  ipcMain.handle('collaboration:acceptExternalSubmission', async (event, id, payload = {}) =>
    collaborationClient.acceptExternalSubmission(id, payload));
  ipcMain.handle('collaboration:rejectExternalSubmission', async (event, id, reason = '') =>
    collaborationClient.rejectExternalSubmission(id, reason));
  ipcMain.handle('collaboration:listDocuments', async (event, params = {}) =>
    collaborationClient.listDocuments(params));
  ipcMain.handle('collaboration:uploadDocument', async (event, metadata = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要归档到资料中心的文件',
      filters: [{ name: '常用资料', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return collaborationClient.uploadDocument(result.filePaths[0], metadata);
  });
  ipcMain.handle('collaboration:downloadDocument', async (event, document) => {
    const result = await dialog.showSaveDialog(mainWindow, { title: '保存资料', defaultPath: document.originalName || '资料' });
    if (result.canceled || !result.filePath) return { canceled: true };
    return collaborationClient.downloadFile(`/api/documents/${encodeURIComponent(document.id)}/download`, result.filePath);
  });
  ipcMain.handle('collaboration:deleteDocument', async (event, id) => collaborationClient.deleteDocument(id));
  ipcMain.handle('collaboration:updateTaskItem', async (event, taskId, itemId, payload) => {
    return collaborationClient.request(
      `/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: payload }
    );
  });
  ipcMain.handle('collaboration:uploadTaskAttachment', async (event, taskId, itemId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要上传到该产品的附件',
      filters: [{ name: '常用附件', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return collaborationClient.uploadTaskAttachment(taskId, itemId, result.filePaths[0]);
  });
  ipcMain.handle('collaboration:uploadTaskAttachmentPath', async (event, taskId, itemId, filePath) => {
    if (!filePath || !path.isAbsolute(filePath)) throw new Error('供应商记录中的附件路径无效');
    return collaborationClient.uploadTaskAttachment(taskId, itemId, filePath);
  });
  ipcMain.handle('collaboration:downloadTaskSource', async (event, task) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存原始询价单',
      defaultPath: task.sourceOriginalName || '原始询价单.xlsx',
      filters: [{ name: 'Excel询价单', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return collaborationClient.downloadFile(
      `/api/tasks/${encodeURIComponent(task.id)}/source`, result.filePath
    );
  });
  ipcMain.handle('collaboration:exportCompletedTask', async (event, task) => {
    const originalName = String(task.sourceOriginalName || '询价单.xlsx').replace(/\.xlsx$/i, '');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出已填写询价单',
      defaultPath: `已填写_${originalName}.xlsx`,
      filters: [{ name: 'Excel询价单', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return collaborationClient.downloadFile(
      `/api/tasks/${encodeURIComponent(task.id)}/export`, result.filePath
    );
  });
  ipcMain.handle('collaboration:downloadTaskAttachment', async (event, taskId, itemId, attachment) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存附件', defaultPath: attachment.name || '附件'
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return collaborationClient.downloadFile(
      `/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/attachments/${encodeURIComponent(attachment.id)}`,
      result.filePath
    );
  });
  ipcMain.handle('collaboration:submitTaskReview', async (event, taskId) => {
    return collaborationClient.request(`/api/tasks/${encodeURIComponent(taskId)}/submit-review`, {
      method: 'POST'
    });
  });
  ipcMain.handle('collaboration:createTaskSnapshot', async (event, taskId) => {
    return collaborationClient.request(`/api/tasks/${encodeURIComponent(taskId)}/snapshots`, {
      method: 'POST'
    });
  });
  ipcMain.handle('collaboration:listNotifications', async () => {
    return collaborationClient.request('/api/notifications');
  });
  ipcMain.handle('collaboration:readNotification', async (event, notificationId) => {
    return collaborationClient.request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'PATCH'
    });
  });
  ipcMain.handle('collaboration:getTaskAudit', async (event, taskId) => {
    return collaborationClient.request(`/api/tasks/${encodeURIComponent(taskId)}/audit`);
  });
  ipcMain.handle('collaboration:getTaskStats', async () => {
    return collaborationClient.request('/api/tasks/stats');
  });
  ipcMain.handle('collaboration:exportTaskCsv', async (event, taskId) => {
    return collaborationClient.downloadFile(
      `/api/tasks/${encodeURIComponent(taskId)}/export/csv`,
      ''
    );
  });
  ipcMain.handle('collaboration:revertTaskItem', async (event, taskId, itemId) => {
    return collaborationClient.request(
      `/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/revert`,
      { method: 'POST' }
    );
  });

  // ========== 模板管理 ==========
  ipcMain.handle('templates:list', async () => {
    return templateManager.listTemplates();
  });

  ipcMain.handle('templates:save', async (event, templateData) => {
    return templateManager.saveTemplate(templateData);
  });

  ipcMain.handle('templates:updateInfo', async (event, templateId, templateData) => {
    return templateManager.updateTemplateInfo(templateId, templateData);
  });

  ipcMain.handle('templates:delete', async (event, templateId) => {
    return templateManager.deleteTemplate(templateId);
  });

  ipcMain.handle('templates:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入Excel模板（仅支持 .xlsx 格式，旧版 .xls 请先另存为 .xlsx）',
      filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const importResult = await templateManager.importTemplate(result.filePaths[0]);
      return importResult;
    } catch (err) {
      console.error('导入模板失败:', err);
      throw err; // 直接抛出，TemplateManager 已经提供了中文错误信息
    }
  });

  ipcMain.handle('templates:export', async (event, templateId) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出模板',
      defaultPath: `template_${templateId}.xlsx`,
      filters: [{ name: 'Excel模板', extensions: ['xlsx'] }]
    });
    if (result.canceled) return false;
    return templateManager.exportTemplate(templateId, result.filePath);
  });

  ipcMain.handle('templates:duplicate', async (event, templateId) => {
    return templateManager.duplicateTemplate(templateId);
  });

  // ========== 模板编辑 ==========
  ipcMain.handle('templates:getStructure', async (event, templateId) => {
    return templateManager.getTemplateStructure(templateId);
  });

  ipcMain.handle('templates:updateStructure', async (event, templateId, structure) => {
    return templateManager.updateTemplateStructure(templateId, structure);
  });

  ipcMain.handle('templates:getPreview', async (event, templateId) => {
    return templateManager.getTemplatePreview(templateId);
  });

  // ========== 字段映射 ==========
  ipcMain.handle('fieldMapping:get', async (event, templateId) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM field_mappings WHERE template_id = ?').all(templateId);
  });

  ipcMain.handle('fieldMapping:save', async (event, templateId, mappings) => {
    const db = getDatabase();
    const deleteStmt = db.prepare('DELETE FROM field_mappings WHERE template_id = ?');
    const insertStmt = db.prepare(
      'INSERT INTO field_mappings (template_id, template_field, system_field) VALUES (?, ?, ?)'
    );
    const transaction = db.transaction(() => {
      deleteStmt.run(templateId);
      for (const m of mappings) {
        insertStmt.run(templateId, m.templateField, m.systemField);
      }
    });
    transaction();
    return true;
  });

  ipcMain.handle('fieldMapping:getSystemFields', async () => {
    return listSystemFields(getDatabase());
  });

  ipcMain.handle('fieldMapping:addSystemField', async (event, field) => {
    return addCustomSystemField(getDatabase(), field);
  });

  ipcMain.handle('fieldMapping:deleteSystemField', async (event, key) => {
    return deleteCustomSystemField(getDatabase(), key);
  });

  // ========== Excel 生成 ==========
  ipcMain.handle('excel:generate', async (event, params = {}) => {
    const { templateId, options, savePath } = params;
    // 兼容旧版调用方的 dataItems，新版统一使用 batches。
    const batches = params.batches || params.dataItems || [];
    // 如果调用方已指定 savePath，直接使用；否则弹出保存对话框
    let finalPath = savePath;
    if (!finalPath) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存生成的Excel文件',
        defaultPath: `生成表格_${new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }]
      });
      if (result.canceled) return { success: false, message: '用户取消' };
      finalPath = result.filePath;
    }
    
    try {
      await excelEngine.generate(templateId, batches, finalPath, options);
      return { success: true, filePath: finalPath };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('excel:preview', async (event, params = {}) => {
    const { templateId, options } = params;
    const batches = params.batches || params.dataItems || [];
    try {
      const previewPath = path.join(app.getPath('temp'), `preview_${Date.now()}.xlsx`);
      await excelEngine.generate(templateId, batches, previewPath, options);
      return { success: true, filePath: previewPath };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('excel:openExisting', async (event, params = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要继续编辑的 Excel 表格',
      filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    try {
      return await excelEngine.readExisting(result.filePaths[0], params.templateId || null);
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('exchangeRate:getToday', async (event, params = {}) => {
    return exchangeRateService.getToday(Boolean(params.force));
  });

  // ========== 询价项目与客户询价单回填（内测） ==========
  ipcMain.handle('rfq:importProject', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '上传客户询价单（.xlsx）',
      filters: [{ name: 'Excel 询价单', extensions: ['xlsx'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    try {
      return {
        canceled: false,
        project: await rfqManager.importProject(result.filePaths[0])
      };
    } catch (error) {
      throw new Error(`询价单导入失败：${error.message}`);
    }
  });

  ipcMain.handle('rfq:listProjects', async () => {
    return rfqManager.listProjects();
  });

  ipcMain.handle('rfq:getProject', async (event, projectId) => {
    return rfqManager.getProject(projectId);
  });

  ipcMain.handle('rfq:deleteProject', async (event, projectId) => {
    return rfqManager.deleteProject(projectId);
  });

  ipcMain.handle('rfq:saveQuoteSet', async (event, payload) => {
    return rfqManager.saveQuoteSet(payload);
  });

  ipcMain.handle('rfq:listQuoteSets', async () => {
    return rfqManager.listQuoteSets();
  });

  ipcMain.handle('rfq:saveSelections', async (event, projectId, selections) => {
    return rfqManager.saveSelections(projectId, selections);
  });

  ipcMain.handle('rfq:generateFilled', async (event, params = {}) => {
    const project = rfqManager.getProject(params.projectId);
    let outputPath = params.outputPath;
    if (!outputPath) {
      const safeName = String(project.name || '已填写询价单')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .slice(0, 80);
      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: '保存已填写的客户询价单',
        defaultPath: `${safeName}_已填写_${new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }]
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }
      outputPath = saveResult.filePath;
    }
    try {
      return await rfqManager.generateFilled(
        params.projectId,
        params.selections || [],
        outputPath,
        params.options || {}
      );
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // ========== 附件选择 ==========
  ipcMain.handle('attachments:select', async (event, params = {}) => {
    const imageOnly = params.kind === 'image';
    const imageOrFile = params.kind === 'any';
    const result = await dialog.showOpenDialog(mainWindow, {
      title: imageOnly ? '选择要显示在 Excel 中的图片' : '选择附件',
      filters: imageOnly
        ? [{ name: '支持的图片', extensions: ['png', 'jpg', 'jpeg', 'gif'] }]
        : [
            { name: '常用附件', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg', 'gif'] },
            { name: '所有文件', extensions: ['*'] }
          ],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const fs = require('fs');
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    const maxSize = imageOnly ? 20 * 1024 * 1024 : 200 * 1024 * 1024;
    if (stats.size > maxSize) {
      throw new Error(imageOnly ? '图片不能超过 20MB' : '附件不能超过 200MB');
    }
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const detectedImage = ['png', 'jpg', 'jpeg', 'gif'].includes(extension);
    return {
      canceled: false,
      file: {
        kind: imageOnly || (imageOrFile && detectedImage) ? 'image' : 'file',
        path: filePath,
        name: path.basename(filePath),
        extension,
        size: stats.size
      }
    };
  });

  // ========== 数据管理 ==========
  ipcMain.handle('data:saveEntry', async (event, entry) => {
    const db = getDatabase();
    const { v4: uuidv4 } = require('uuid');
    const id = entry.id || uuidv4();
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT OR REPLACE INTO data_entries (id, type, data, created_at, updated_at)
      VALUES (?, ?, ?, COALESCE((SELECT created_at FROM data_entries WHERE id = ?), ?), ?)
    `).run(id, entry.type, JSON.stringify(entry.data), id, now, now);
    
    return { success: true, id };
  });

  ipcMain.handle('data:getEntries', async (event, type) => {
    const db = getDatabase();
    if (type) {
      return db.prepare('SELECT * FROM data_entries WHERE type = ? ORDER BY updated_at DESC').all(type);
    }
    return db.prepare('SELECT * FROM data_entries ORDER BY updated_at DESC').all();
  });

  ipcMain.handle('data:deleteEntry', async (event, id) => {
    const db = getDatabase();
    db.prepare('DELETE FROM data_entries WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('data:getEntry', async (event, id) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM data_entries WHERE id = ?').get(id);
  });

  ipcMain.handle('draft:get', async (event, templateId) => {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT payload, updated_at FROM data_entry_drafts WHERE id = ?'
    ).get(`data-entry:${templateId}`);
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.payload), updatedAt: row.updated_at };
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('draft:save', async (event, templateId, payload) => {
    const db = getDatabase();
    const id = `data-entry:${templateId}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO data_entry_drafts (id, template_id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(id, templateId, JSON.stringify(payload || {}), now, now);
    return { success: true, updatedAt: now };
  });

  ipcMain.handle('draft:delete', async (event, templateId) => {
    getDatabase().prepare('DELETE FROM data_entry_drafts WHERE id = ?')
      .run(`data-entry:${templateId}`);
    return true;
  });

  ipcMain.handle('database:listBackups', async () => {
    return listDatabaseBackups();
  });

  ipcMain.handle('database:createBackup', async () => {
    return createDatabaseBackup('manual');
  });

  ipcMain.handle('database:openBackupFolder', async () => {
    const backupsDir = getBackupsDir();
    require('fs').mkdirSync(backupsDir, { recursive: true });
    const errorMessage = await shell.openPath(backupsDir);
    return { success: !errorMessage, message: errorMessage };
  });

  ipcMain.handle('database:restoreBackup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据库备份',
      filters: [{ name: '数据库备份', extensions: ['db'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const restored = restoreDatabaseBackup(result.filePaths[0]);
    setImmediate(() => {
      app.relaunch();
      app.exit(0);
    });
    return restored;
  });

  ipcMain.handle('database:getTables', async () => {
    const db = getDatabase();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    return tables.map(t => {
      const count = db.prepare(`SELECT COUNT(*) AS count FROM "${t.name}"`).get();
      return { name: t.name, rowCount: count?.count || 0 };
    });
  });

  ipcMain.handle('database:getTableData', async (event, tableName, page = 0, pageSize = 100) => {
    const db = getDatabase();
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all().map(c => c.name);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get().count;
    const rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`)
      .all(pageSize, page * pageSize);
    return { columns, rows, total };
  });

  ipcMain.handle('database:runQuery', async (event, sql) => {
    if (!sql || !/^\s*SELECT/i.test(sql)) throw new Error('仅支持 SELECT 查询');
    const db = getDatabase();
    const rows = db.prepare(sql).all();
    if (rows.length === 0) return { columns: [], rows: [], total: 0 };
    const columns = Object.keys(rows[0]);
    return { columns, rows, total: rows.length };
  });

  // ========== 历史记录 ==========
  ipcMain.handle('history:list', async () => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM generation_history ORDER BY created_at DESC LIMIT 100
    `).all();
  });

  ipcMain.handle('history:add', async (event, record) => {
    const db = getDatabase();
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.prepare(`
      INSERT INTO generation_history (id, template_id, template_name, data_summary, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, record.templateId, record.templateName, JSON.stringify(record.dataSummary), record.filePath, new Date().toISOString());
    return id;
  });

  // ========== 文件对话框 ==========
  ipcMain.handle('dialog:openFile', async (event, options) => {
    return dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle('dialog:saveFile', async (event, options) => {
    return dialog.showSaveDialog(mainWindow, options);
  });

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择保存文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:createFolder', async (event, parentPath, folderName) => {
    const fs = require('fs');
    const newPath = path.join(parentPath, folderName);
    try {
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
        return { success: true, path: newPath };
      }
      return { success: false, message: '文件夹已存在' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('app:getDesktopPath', async () => {
    return path.join(app.getPath('home'), 'Desktop');
  });

  ipcMain.handle('app:getVersion', async () => app.getVersion());
}
