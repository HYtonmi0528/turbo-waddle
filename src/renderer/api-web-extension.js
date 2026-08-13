// Web-only additions kept separate from the legacy Electron bridge.
(function () {
  const api = window.electronAPI = window.electronAPI || {};
  const collab = api.collaboration = api.collaboration || {};
  const app = api.app = api.app || {};
  const fieldMapping = api.fieldMapping = api.fieldMapping || {};
  const request = (url, options) => fetch(url, Object.assign({ credentials: 'same-origin' }, options || {})).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `请求失败（${response.status}）`);
    return body;
  });
  app.getVersion = () => request('/api/version').then(result => result.version || 'web').catch(() => 'web');
  collab.listExternalSubmissions = () => request('/api/external/rfqs');
  collab.submitExternalRfq = ({ title, file }) => { const form = new FormData(); form.append('file', file); if (title) form.append('title', title); return request('/api/external/rfqs/submit', { method: 'POST', body: form }); };
  collab.registerRole = payload => request('/api/auth/register/role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  collab.acceptExternalSubmission = (id, payload = {}) => request(`/api/external/rfqs/${encodeURIComponent(id)}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  collab.rejectExternalSubmission = (id, reason = '') => request(`/api/external/rfqs/${encodeURIComponent(id)}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
  collab.listDocuments = (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return request(`/api/documents${query ? `?${query}` : ''}`);
  };
  collab.uploadDocument = (metadata = {}) => new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.png,.jpg,.jpeg,.gif,.webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true });
      const form = new FormData();
      form.append('file', file);
      Object.entries(metadata).forEach(([key, value]) => { if (value != null && value !== '') form.append(key, String(value)); });
      try { resolve(await request('/api/documents', { method: 'POST', body: form })); } catch (error) { resolve({ error: error.message }); }
    };
    input.click();
  });
  collab.downloadDocument = item => { const link = window.document.createElement('a'); link.href = `/api/documents/${encodeURIComponent(item.id)}/download`; link.download = item.originalName || '资料'; link.click(); return Promise.resolve({ success: true }); };
  collab.deleteDocument = id => request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  collab.assignTaskItem = (taskId, itemId, assignedUserId) => request(`/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/assignee`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedUserId }) });
  fieldMapping.addSystemField = payload => request('/api/fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(result => result.field || result);
})();
