const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  collaboration: {
    getState: () => ipcRenderer.invoke('collaboration:getState'),
    configure: (serverUrl) => ipcRenderer.invoke('collaboration:configure', serverUrl),
    restoreSession: () => ipcRenderer.invoke('collaboration:restoreSession'),
    setupAdmin: (payload) => ipcRenderer.invoke('collaboration:setupAdmin', payload),
    register: (payload) => ipcRenderer.invoke('collaboration:register', payload),
    login: (payload) => ipcRenderer.invoke('collaboration:login', payload),
    logout: () => ipcRenderer.invoke('collaboration:logout'),
    getRememberedLogin: () => ipcRenderer.invoke('collaboration:getRememberedLogin'),
    clearRememberedLogin: () => ipcRenderer.invoke('collaboration:clearRememberedLogin'),
    listUsers: () => ipcRenderer.invoke('collaboration:listUsers'),
    updateUserStatus: (userId, status) =>
      ipcRenderer.invoke('collaboration:updateUserStatus', userId, status),
    updateUserRole: (userId, role) =>
      ipcRenderer.invoke('collaboration:updateUserRole', userId, role),
    listRemoteTemplates: () => ipcRenderer.invoke('collaboration:listRemoteTemplates'),
    saveRemoteTemplate: (template) => ipcRenderer.invoke('collaboration:saveRemoteTemplate', template),
    listTasks: () => ipcRenderer.invoke('collaboration:listTasks'),
    getTask: (taskId) => ipcRenderer.invoke('collaboration:getTask', taskId),
    importTask: (metadata) => ipcRenderer.invoke('collaboration:importTask', metadata),
    updateTaskItem: (taskId, itemId, payload) =>
      ipcRenderer.invoke('collaboration:updateTaskItem', taskId, itemId, payload),
    uploadTaskAttachment: (taskId, itemId) =>
      ipcRenderer.invoke('collaboration:uploadTaskAttachment', taskId, itemId),
    uploadTaskAttachmentPath: (taskId, itemId, filePath) =>
      ipcRenderer.invoke('collaboration:uploadTaskAttachmentPath', taskId, itemId, filePath),
    downloadTaskSource: (task) => ipcRenderer.invoke('collaboration:downloadTaskSource', task),
    exportCompletedTask: (task) => ipcRenderer.invoke('collaboration:exportCompletedTask', task),
    downloadTaskAttachment: (taskId, itemId, attachment) =>
      ipcRenderer.invoke('collaboration:downloadTaskAttachment', taskId, itemId, attachment),
    submitTaskReview: (taskId) => ipcRenderer.invoke('collaboration:submitTaskReview', taskId),
    createTaskSnapshot: (taskId) => ipcRenderer.invoke('collaboration:createTaskSnapshot', taskId),
    listNotifications: () => ipcRenderer.invoke('collaboration:listNotifications'),
    readNotification: (notificationId) =>
      ipcRenderer.invoke('collaboration:readNotification', notificationId),
    getTaskAudit: (taskId) => ipcRenderer.invoke('collaboration:getTaskAudit', taskId),
    getTaskStats: () => ipcRenderer.invoke('collaboration:getTaskStats'),
    exportTaskCsv: (taskId) => ipcRenderer.invoke('collaboration:exportTaskCsv', taskId),
    revertTaskItem: (taskId, itemId) => ipcRenderer.invoke('collaboration:revertTaskItem', taskId, itemId)
  },
  // 模板管理
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (data) => ipcRenderer.invoke('templates:save', data),
    updateInfo: (id, data) => ipcRenderer.invoke('templates:updateInfo', id, data),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    import: () => ipcRenderer.invoke('templates:import'),
    export: (id) => ipcRenderer.invoke('templates:export', id),
    duplicate: (id) => ipcRenderer.invoke('templates:duplicate', id),
    getStructure: (id) => ipcRenderer.invoke('templates:getStructure', id),
    updateStructure: (id, structure) => ipcRenderer.invoke('templates:updateStructure', id, structure),
    getPreview: (id) => ipcRenderer.invoke('templates:getPreview', id)
  },
  // 字段映射
  fieldMapping: {
    get: (templateId) => ipcRenderer.invoke('fieldMapping:get', templateId),
    save: (templateId, mappings) => ipcRenderer.invoke('fieldMapping:save', templateId, mappings),
    getSystemFields: () => ipcRenderer.invoke('fieldMapping:getSystemFields'),
    addSystemField: (field) => ipcRenderer.invoke('fieldMapping:addSystemField', field),
    deleteSystemField: (key) => ipcRenderer.invoke('fieldMapping:deleteSystemField', key)
  },
  // Excel生成
  excel: {
    generate: (params) => ipcRenderer.invoke('excel:generate', params),
    preview: (params) => ipcRenderer.invoke('excel:preview', params),
    openExisting: (params) => ipcRenderer.invoke('excel:openExisting', params)
  },
  exchangeRate: {
    getToday: (params = {}) => ipcRenderer.invoke('exchangeRate:getToday', params)
  },
  rfq: {
    importProject: () => ipcRenderer.invoke('rfq:importProject'),
    listProjects: () => ipcRenderer.invoke('rfq:listProjects'),
    getProject: (projectId) => ipcRenderer.invoke('rfq:getProject', projectId),
    deleteProject: (projectId) => ipcRenderer.invoke('rfq:deleteProject', projectId),
    saveQuoteSet: (payload) => ipcRenderer.invoke('rfq:saveQuoteSet', payload),
    listQuoteSets: () => ipcRenderer.invoke('rfq:listQuoteSets'),
    saveSelections: (projectId, selections) =>
      ipcRenderer.invoke('rfq:saveSelections', projectId, selections),
    generateFilled: (params) => ipcRenderer.invoke('rfq:generateFilled', params)
  },
  attachments: {
    select: (params = {}) => ipcRenderer.invoke('attachments:select', params)
  },
  update: {
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
    getInstalledReleaseNotes: () => ipcRenderer.invoke('update:getInstalledReleaseNotes'),
    acknowledgeReleaseNotes: (version) => ipcRenderer.invoke('update:acknowledgeReleaseNotes', version),
    check: () => ipcRenderer.invoke('update:check'),
    restartAndInstall: () => ipcRenderer.invoke('update:restartAndInstall'),
    onStatus: (callback) => {
      const listener = (event, status) => callback(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    }
  },
  // 数据管理
  data: {
    saveEntry: (entry) => ipcRenderer.invoke('data:saveEntry', entry),
    getEntries: (type) => ipcRenderer.invoke('data:getEntries', type),
    deleteEntry: (id) => ipcRenderer.invoke('data:deleteEntry', id),
    getEntry: (id) => ipcRenderer.invoke('data:getEntry', id)
  },
  draft: {
    get: (templateId) => ipcRenderer.invoke('draft:get', templateId),
    save: (templateId, payload) => ipcRenderer.invoke('draft:save', templateId, payload),
    delete: (templateId) => ipcRenderer.invoke('draft:delete', templateId)
  },
  database: {
    listBackups: () => ipcRenderer.invoke('database:listBackups'),
    createBackup: () => ipcRenderer.invoke('database:createBackup'),
    openBackupFolder: () => ipcRenderer.invoke('database:openBackupFolder'),
    restoreBackup: () => ipcRenderer.invoke('database:restoreBackup'),
    getTables: () => ipcRenderer.invoke('database:getTables'),
    getTableData: (tableName, page, pageSize) => ipcRenderer.invoke('database:getTableData', tableName, page, pageSize),
    runQuery: (sql) => ipcRenderer.invoke('database:runQuery', sql)
  },
  // 历史记录
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    add: (record) => ipcRenderer.invoke('history:add', record)
  },
  // 文件对话框
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    createFolder: (parentPath, folderName) => ipcRenderer.invoke('dialog:createFolder', parentPath, folderName)
  },
  // 应用信息
  app: {
    getDesktopPath: () => ipcRenderer.invoke('app:getDesktopPath'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  }
});
