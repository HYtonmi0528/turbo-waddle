const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const DEFAULT_SERVER_URL = 'http://101.37.17.111:3210';

class CollaborationClient {
  constructor() {
    this.store = new Store({ name: 'collaboration-session', defaults: { serverUrl: DEFAULT_SERVER_URL } });
  }

  encrypt(text) {
    if (!text) return null;
    if (!safeStorage.isEncryptionAvailable()) return Buffer.from(text, 'utf8').toString('base64');
    return safeStorage.encryptString(text).toString('base64');
  }

  decrypt(base64) {
    if (!base64) return null;
    try {
      const buffer = Buffer.from(base64, 'base64');
      if (!safeStorage.isEncryptionAvailable()) return buffer.toString('utf8');
      return safeStorage.decryptString(buffer);
    } catch (_) {
      return null;
    }
  }

  normalizeServerUrl(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) throw new Error('服务器地址必须以 http:// 或 https:// 开头');
    return url;
  }

  async getState() {
    const state = {
      serverUrl: this.store.get('serverUrl', DEFAULT_SERVER_URL),
      user: this.store.get('user', null),
      hasSession: Boolean(this.store.get('token'))
    };
    try { state.setup = await this.request('/api/setup/status', { auth: false, timeout: 8000 }); } catch (_) { state.setup = null; }
    return state;
  }

  async request(apiPath, options = {}) {
    const baseUrl = this.store.get('serverUrl', DEFAULT_SERVER_URL) || DEFAULT_SERVER_URL;
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

  async registerRole(payload) {
    return this.request('/api/auth/register/role', { method: 'POST', body: payload, auth: false });
  }

  async login(payload) {
    const result = await this.request('/api/auth/login', { method: 'POST', body: payload, auth: false });
    this.store.set('token', result.token);
    this.store.set('user', result.user);
    if (payload.remember) {
      this.store.set('rememberedLogin', {
        username: payload.username,
        entrance: payload.entrance || result.user.role,
        passwordEncrypted: this.encrypt(payload.password)
      });
    }
    return result;
  }

  getRememberedLogin() {
    const saved = this.store.get('rememberedLogin', null);
    if (!saved) return null;
    return {
      username: saved.username,
      entrance: saved.entrance,
      password: this.decrypt(saved.passwordEncrypted)
    };
  }

  clearRememberedLogin() {
    this.store.delete('rememberedLogin');
  }

  async restoreSession() {
    if (!this.store.get('token')) return null;
    try {
      const result = await this.request('/api/auth/me', { timeout: 5000 });
      this.store.set('user', result.user);
      return result.user;
    } catch (error) {
      if (error.status === 401) {
        this.clearSession();
        return null;
      }
      throw error;
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

  listExternalSubmissions() {
    return this.request('/api/external/rfqs');
  }

  async uploadExternalRfq(filePath, metadata = {}) {
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(filePath));
    Object.entries(metadata).forEach(([key, value]) => { if (value != null && value !== '') form.append(key, String(value)); });
    return this.request('/api/external/rfqs/submit', { method: 'POST', body: form, timeout: 120000 });
  }

  acceptExternalSubmission(id, payload = {}) {
    return this.request(`/api/external/rfqs/${encodeURIComponent(id)}/accept`, {
      method: 'POST', body: payload
    });
  }

  rejectExternalSubmission(id, reason = '') {
    return this.request(`/api/external/rfqs/${encodeURIComponent(id)}/reject`, {
      method: 'POST', body: { reason }
    });
  }

  listDocuments(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return this.request(`/api/documents${query ? `?${query}` : ''}`);
  }

  async uploadDocument(filePath, metadata = {}) {
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(filePath));
    Object.entries(metadata).forEach(([key, value]) => { if (value != null && value !== '') form.append(key, String(value)); });
    return this.request('/api/documents', { method: 'POST', body: form, timeout: 120000 });
  }

  deleteDocument(id) {
    return this.request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
