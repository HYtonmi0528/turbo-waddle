const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

class CollaborationClient {
  constructor() {
    this.store = new Store({ name: 'collaboration-session' });
  }

  normalizeServerUrl(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) throw new Error('服务器地址必须以 http:// 或 https:// 开头');
    return url;
  }

  getState() {
    return {
      serverUrl: this.store.get('serverUrl', ''),
      user: this.store.get('user', null),
      hasSession: Boolean(this.store.get('token'))
    };
  }

  async request(apiPath, options = {}) {
    const baseUrl = this.store.get('serverUrl', '');
    if (!baseUrl) throw new Error('请先配置服务器地址');
    const headers = { ...(options.headers || {}) };
    if (options.auth !== false) {
      const token = this.store.get('token', '');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let body = options.body;
    if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(`${baseUrl}${apiPath}`, {
        method: options.method || 'GET',
        headers,
        body,
        signal: AbortSignal.timeout(options.timeout || 20000)
      });
    } catch (error) {
      throw new Error(`无法连接服务器：${error.message}`);
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
    if (!response.ok) {
      const error = new Error(data.message || `服务器返回 ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async configure(serverUrl) {
    const normalized = this.normalizeServerUrl(serverUrl);
    const previous = this.store.get('serverUrl', '');
    this.store.set('serverUrl', normalized);
    try {
      const health = await this.request('/api/health', { auth: false, timeout: 8000 });
      const setup = await this.request('/api/setup/status', { auth: false, timeout: 8000 });
      if (previous && previous !== normalized) this.clearSession();
      return { serverUrl: normalized, health, setup };
    } catch (error) {
      if (previous) this.store.set('serverUrl', previous);
      else this.store.delete('serverUrl');
      throw error;
    }
  }

  clearSession() {
    this.store.delete('token');
    this.store.delete('user');
  }

  async setupAdmin(payload) {
    return this.request('/api/setup/admin', { method: 'POST', body: payload, auth: false });
  }

  async register(payload) {
    return this.request('/api/auth/register', { method: 'POST', body: payload, auth: false });
  }

  async login(payload) {
    const result = await this.request('/api/auth/login', { method: 'POST', body: payload, auth: false });
    this.store.set('token', result.token);
    this.store.set('user', result.user);
    return result;
  }

  async restoreSession() {
    if (!this.store.get('token')) return null;
    try {
      const result = await this.request('/api/auth/me');
      this.store.set('user', result.user);
      return result.user;
    } catch (_) {
      this.clearSession();
      return null;
    }
  }

  async logout() {
    try { await this.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    this.clearSession();
    return true;
  }

  async importTask(filePath, metadata = {}) {
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(filePath));
    for (const [key, value] of Object.entries(metadata)) {
      if (value == null || value === '') continue;
      form.append(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    }
    return this.request('/api/tasks/import', { method: 'POST', body: form, timeout: 120000 });
  }

  async uploadTaskAttachment(taskId, itemId, filePath) {
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(filePath));
    return this.request(
      `/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/attachments`,
      { method: 'POST', body: form, timeout: 120000 }
    );
  }

  async downloadFile(apiPath, savePath) {
    const baseUrl = this.store.get('serverUrl', '');
    const token = this.store.get('token', '');
    const response = await fetch(`${baseUrl}${apiPath}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text).message; } catch (_) {}
      throw new Error(message || '文件下载失败');
    }
    fs.writeFileSync(savePath, Buffer.from(await response.arrayBuffer()));
    return { success: true, filePath: savePath };
  }
}

module.exports = { CollaborationClient };
