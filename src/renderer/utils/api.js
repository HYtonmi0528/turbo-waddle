const BASE = '';

async function request(path, options = {}) {
  const headers = {};
  let body = options.body;
  if (body != null && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const resp = await fetch(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(options.timeout || 20000),
    credentials: 'same-origin'
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
  if (!resp.ok) throw new Error(data.message || `服务器返回 ${resp.status}`);
  return data;
}

async function download(path, saveAs) {
  const resp = await fetch(`${BASE}${path}`, { credentials: 'same-origin' });
  if (!resp.ok) throw new Error('下载失败');
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = saveAs || 'download';
  a.click();
  URL.revokeObjectURL(url);
  return { success: true };
}

const api = {
  collaboration: {
    getState: () => request('/api/setup/status'),
    configure: (serverUrl) => request('/api/setup/status'),
    restoreSession: () => request('/api/auth/me').then(r => r.user).catch(() => null),
    setupAdmin: (payload) => request('/api/setup/admin', { method: 'POST', body: payload }),
    register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
    login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
    logout: () => request('/api/auth/logout', { method: 'POST' }).catch(() => ({ ok: true })),
    getRememberedLogin: () => null,
    clearRememberedLogin: () => {},
    listUsers: () => request('/api/users'),
    updateUserStatus: (userId, status) => request(`/api/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: { status } }),
    updateUserRole: (userId, role) => request(`/api/users/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: { role } }),
    listRemoteTemplates: () => request('/api/templates'),
    saveRemoteTemplate: (template) => request('/api/templates', { method: 'POST', body: template }),
    listTasks: () => request('/api/tasks'),
    getTask: (taskId) => request(`/api/tasks/${encodeURIComponent(taskId)}`),
    importTask: (metadata) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx';
      return new Promise(resolve => {
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return resolve({ canceled: true });
          const form = new FormData();
          form.append('file', file);
          for (const [k, v] of Object.entries(metadata || {})) {
            if (v != null && v !== '') form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
          }
          try {
            resolve(await request('/api/tasks/import', { method: 'POST', body: form, timeout: 120000 }));
          } catch (e) {
            throw e;
          }
        };
        input.click();
      });
    },
    updateTaskItem: (taskId, itemId, payload) =>
      request(`/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: payload }),
    uploadTaskAttachment: (taskId, itemId) => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve({ canceled: true });
        const form = new FormData();
        form.append('file', file);
        resolve(request(`/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/attachments`, { method: 'POST', body: form, timeout: 120000 }));
      };
      input.click();
    }),
    uploadTaskAttachmentPath: () => Promise.reject(new Error('Web版请使用附件上传按钮')),
    downloadTaskSource: (task) => download(`/api/tasks/${encodeURIComponent(task.id)}/source`, task.sourceOriginalName),
    exportCompletedTask: (task) => download(`/api/tasks/${encodeURIComponent(task.id)}/export`, `已填写_${(task.sourceOriginalName || '').replace(/\.xlsx$/i, '')}.xlsx`),
    downloadTaskAttachment: (taskId, itemId, attachment) => download(`/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/attachments/${encodeURIComponent(attachment.id)}`, attachment.name),
    submitTaskReview: (taskId) => request(`/api/tasks/${encodeURIComponent(taskId)}/submit-review`, { method: 'POST' }),
    createTaskSnapshot: (taskId) => request(`/api/tasks/${encodeURIComponent(taskId)}/snapshots`, { method: 'POST' }),
    listNotifications: () => request('/api/notifications'),
    readNotification: (notificationId) => request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }),
    getTaskAudit: (taskId) => request(`/api/tasks/${encodeURIComponent(taskId)}/audit`),
    revertTaskItem: (taskId, itemId) => request(`/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/revert`, { method: 'POST' }),
    exportTaskCsv: (taskId) => request(`/api/tasks/${encodeURIComponent(taskId)}/export/csv`),
    getTaskStats: () => request('/api/tasks/stats')
  },
  app: {
    getVersion: () => request('/api/health').then(r => r.service || ''),
    getDesktopPath: () => ''
  }
};

window.electronAPI = api;
