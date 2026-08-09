import React, { useCallback, useEffect, useRef, useState } from 'react';
import App from '../App';
import CollaborationWorkspace from './CollaborationWorkspace';
import AccountAdmin from './AccountAdmin';
import RemoteTemplates from './RemoteTemplates';
import DatabaseBrowser from './DatabaseBrowser';
import Dashboard from './Dashboard';
import ExternalInbox from './ExternalInbox';
import DocumentCenter from './DocumentCenter';
import appLogo from '../../../assets/app-logo.png';

function cleanError(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
}

function ConnectionScreen({ initialUrl, onConnected }) {
  const [serverUrl, setServerUrl] = useState(initialUrl || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.collaboration.configure(serverUrl);
      onConnected(result);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="collab-auth-page">
      <div className="collab-auth-card">
        <img src={appLogo} alt="LATIC" className="collab-auth-logo" />
        <h1>连接询价协作服务器</h1>
        <p>当前电脑作为服务器时使用本机地址；其他员工电脑填写服务器的局域网IP。</p>
        <form onSubmit={connect}>
          <label className="form-label" htmlFor="server-url">服务器地址</label>
          <input
            id="server-url"
            className="form-input"
            value={serverUrl}
            onChange={event => setServerUrl(event.target.value)}
            placeholder="http://192.168.1.100:3210"
            required
          />
          <div className="collab-connection-help">
            管理员和员工都填写同一个团队服务器地址。<br />
            只有数据库服务运行在当前电脑时，才能使用 http://127.0.0.1:3210
          </div>
          <button type="button" className="btn btn-outline collab-full-button" onClick={() => setServerUrl('http://127.0.0.1:3210')}>这台电脑运行服务器，使用本机地址</button>
          {error && <div className="collab-form-error">{error}</div>}
          <button className="btn btn-primary btn-lg collab-full-button" disabled={busy}>
            {busy ? '正在测试连接…' : '测试并保存连接'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AccessScreen({ setup, onLogin, onReconfigure, onRefreshSetup }) {
  const [entrance, setEntrance] = useState('employee');
  const getInitialMode = value => value?.initialized ? 'login' : 'choose-setup';
  const [mode, setMode] = useState(getInitialMode(setup));
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [registerRole, setRegisterRole] = useState('viewer');

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));

  useEffect(() => {
    (async () => {
      const saved = await window.electronAPI.collaboration.getRememberedLogin();
      if (saved) {
        setForm(current => ({ ...current, username: saved.username }));
        setRememberMe(true);
        if (saved.entrance) setEntrance(saved.entrance);
      }
    })();
  }, []);

  useEffect(() => {
    setMode(getInitialMode(setup));
  }, [setup?.initialized, setup?.canInitialize]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'setup') {
        await window.electronAPI.collaboration.setupAdmin(form);
        setMessage('管理员创建成功，请使用管理员入口登录。');
        setEntrance('admin');
        setMode('login');
      } else if (mode === 'register') {
        const result = await window.electronAPI.collaboration.register({ ...form, role: registerRole });
        setMessage(result.message || '注册成功，请等待管理员启用账号。');
        setMode('login');
      } else {
        const result = await window.electronAPI.collaboration.login({
          username: form.username,
          password: form.password,
          entrance,
          remember: rememberMe
        });
        onLogin(result.user);
      }
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="collab-auth-page">
      <div className="collab-auth-card collab-login-card">
        <img src={appLogo} alt="LATIC" className="collab-auth-logo" />
        <h1>{mode === 'setup' ? '创建初始管理员' : mode === 'choose-setup' ? '系统尚未初始化' : mode === 'waiting' ? '等待负责人初始化' : mode === 'register' ? '员工注册' : '登录询价协作系统'}</h1>
        {mode === 'choose-setup' && (
          <div className="collab-waiting-setup">
            <p>团队中只需要一位负责人创建第一个管理员账号，管理员不必使用服务器电脑。</p>
            <button type="button" className="btn btn-primary btn-lg collab-full-button" onClick={() => setMode('setup')}>我是负责人，创建初始管理员</button>
            <button type="button" className="btn btn-outline collab-full-button" onClick={() => setMode('waiting')}>我是员工，等待负责人创建</button>
            <button type="button" className="btn btn-outline collab-full-button" onClick={onReconfigure}>← 返回服务器连接</button>
          </div>
        )}
        {mode === 'waiting' && (
          <div className="collab-waiting-setup">
            <p>请等待负责人在任意一台已连接团队服务器的电脑上创建初始管理员。</p>
            <button type="button" className="btn btn-primary btn-lg collab-full-button" onClick={onRefreshSetup}>重新检查</button>
            <button type="button" className="btn btn-outline collab-full-button" onClick={() => setMode('choose-setup')}>← 返回身份选择</button>
            <button type="button" className="btn btn-outline collab-full-button" onClick={onReconfigure}>← 返回服务器连接</button>
          </div>
        )}
        {mode === 'login' && (
          <div className="collab-entrance-switch">
            <button type="button" className={entrance === 'employee' ? 'active' : ''} onClick={() => setEntrance('employee')}>普通员工入口</button>
            <button type="button" className={entrance === 'admin' ? 'active' : ''} onClick={() => setEntrance('admin')}>管理员入口</button>
          </div>
        )}
        {mode !== 'waiting' && mode !== 'choose-setup' && <form onSubmit={submit}>
          {(mode === 'setup' || mode === 'register') && (
            <div className="form-group">
              <label className="form-label" htmlFor="display-name">姓名</label>
              <input id="display-name" className="form-input" value={form.displayName} onChange={event => update('displayName', event.target.value)} required />
            </div>
          )}
          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">角色</label>
              <select className="form-select" value={registerRole} onChange={e => setRegisterRole(e.target.value)}>
                <option value="viewer">查看者（只读）</option>
                <option value="purchaser">采购员（录入数据）</option>
                <option value="manager">经理（审批+管理）</option>
                <option value="admin">管理员（全部权限）</option>
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="username">账号</label>
            <input id="username" className="form-input" value={form.username} onChange={event => update('username', event.target.value)} required autoComplete="username" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">密码</label>
            <input id="password" className="form-input" type="password" minLength="8" value={form.password} onChange={event => update('password', event.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
          {mode === 'login' && (
            <label className="form-checkbox">
              <input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} />
              记住密码（下次自动登录）
            </label>
          )}
          {error && <div className="collab-form-error">{error}</div>}
          {message && <div className="collab-form-success">{message}</div>}
          <button className="btn btn-primary btn-lg collab-full-button" disabled={busy}>
            {busy ? '正在处理…' : mode === 'setup' ? '创建管理员' : mode === 'register' ? '提交注册' : '登录'}
          </button>
        </form>}
        {mode !== 'waiting' && mode !== 'choose-setup' && <div className="collab-auth-links">
          {mode === 'setup' ? (
            <button type="button" onClick={() => setMode('choose-setup')}>← 返回身份选择</button>
          ) : (
            <button type="button" onClick={() => {
              setError('');
              setMessage('');
              setMode(mode === 'register' ? 'login' : 'register');
            }}>
              {mode === 'register' ? '← 返回登录' : '注册普通员工账号'}
            </button>
          )}
          {mode !== 'setup' && <button type="button" onClick={onReconfigure}>修改服务器连接</button>}
        </div>}
      </div>
    </div>
  );
}

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(1174, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.32);
    oscillator.addEventListener('ended', () => context.close());
  } catch (_) {}
}

export default function CollaborationShell() {
  const [showSplash, setShowSplash] = useState(true);
  const [phase, setPhase] = useState('loading');
  const [connection, setConnection] = useState({ serverUrl: '', setup: null });
  const [user, setUser] = useState(null);
  const [activeArea, setActiveArea] = useState('dashboard');
  const [notifications, setNotifications] = useState([]);
  const [appVersion, setAppVersion] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const knownNotificationIds = useRef(new Set());
  const firstNotificationLoad = useRef(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const setup = await window.electronAPI.collaboration.getState();
        if (!mounted) return;
        setConnection({ setup });
        const restoredUser = await window.electronAPI.collaboration.restoreSession();
        if (!mounted) return;
        if (restoredUser) {
          setUser(restoredUser);
          setPhase('app');
        } else {
          setPhase('access');
        }
      } catch (_) {
        if (mounted) setPhase('access');
      }
    })();
    return () => { mounted = false; };
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const result = await window.electronAPI.collaboration.listNotifications();
      const incoming = result.notifications || [];
      if (!firstNotificationLoad.current) {
        const hasNew = incoming.some(item => !item.isRead && !knownNotificationIds.current.has(item.id));
        if (hasNew) {
          playNotificationSound();
          for (const item of incoming) {
            if (!item.isRead && !knownNotificationIds.current.has(item.id)) {
              try {
                new Notification(item.title, { body: item.message || '', tag: item.id });
              } catch (_) {}
            }
          }
        }
      }
      knownNotificationIds.current = new Set(incoming.map(item => item.id));
      firstNotificationLoad.current = false;
      setNotifications(incoming);
    } catch (_) {}
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    loadNotifications();
    const timer = setInterval(loadNotifications, 10000);
    return () => clearInterval(timer);
  }, [user, loadNotifications]);

  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.key === '1') { e.preventDefault(); setActiveArea('dashboard'); }
      if (e.ctrlKey && e.key === '2') { e.preventDefault(); setActiveArea('tasks'); }
      if (e.ctrlKey && e.key === '3') { e.preventDefault(); setActiveArea('templates'); }
      if (e.ctrlKey && e.key === '4') { e.preventDefault(); setActiveArea('legacy'); }
      if (e.key === 'Escape' && activeArea !== 'dashboard') { e.preventDefault(); setActiveArea('dashboard'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeArea]);

  const logout = async () => {
    await window.electronAPI.collaboration.logout();
    setUser(null);
    setPhase('access');
    setActiveArea('tasks');
  };

  if (showSplash) return <div className="startup-splash"><img src={appLogo} alt="LATIC" onAnimationEnd={() => setShowSplash(false)} /></div>;
  if (phase === 'loading') return <div className="collab-loading">正在启动询价协作系统…</div>;
  if (phase === 'access') {
    return <AccessScreen setup={connection.setup} onLogin={nextUser => {
      setUser(nextUser);
      firstNotificationLoad.current = true;
      setPhase('app');
      try { Notification.requestPermission(); } catch (_) {}
    }} onReconfigure={() => setPhase('access')} onRefreshSetup={async () => {
      const result = await window.electronAPI.collaboration.getState();
      setConnection({ setup: result });
    }} />;
  }

  const unreadCount = notifications.filter(item => !item.isRead).length;

  const handleSearch = async (val) => {
    setSearchQuery(val);
    if (val.trim().length >= 2) {
      try {
        const r = await window.electronAPI.collaboration.search(val.trim());
        setSearchResults(r);
      } catch (_) { setSearchResults(null); }
    } else { setSearchResults(null); }
  };

  const clearSearch = () => { setSearchQuery(''); setSearchResults(null); };

  return (
    <div className="collab-shell">
      <header className="collab-shell-header">
        <div className="collab-brand"><img src={appLogo} alt="" /><div><strong>LATIC询价协作系统</strong><span>局域网内测版</span></div></div>
        <div className="collab-search-bar">
          <input className="form-input collab-search-input" placeholder="搜索任务/产品/供应商…" value={searchQuery} onChange={e => handleSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') clearSearch(); }} />
          {searchResults && (searchResults.tasks?.length > 0 || searchResults.items?.length > 0) && (
            <div className="collab-search-dropdown">
              {searchResults.tasks?.slice(0, 5).map(t => (
                <button key={'t'+t.id} onClick={() => { clearSearch(); setActiveArea('tasks'); }}>
                  <span className={`collab-status status-${t.status}`}>{t.status === 'published' ? '已下发' : t.status === 'in_progress' ? '进行中' : t.status === 'review' ? '待审核' : t.status}</span>
                  <strong>{t.title}</strong>
                  <span className="text-muted">{t.taskNo}</span>
                </button>
              ))}
              {searchResults.items?.slice(0, 5).map(i => (
                <button key={'ii'+i.id} onClick={() => { clearSearch(); setActiveArea('tasks'); }}>
                  <span>#{i.lineNo}</span>
                  <strong>{i.description}</strong>
                  <span className="text-muted">{i.taskNo}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="collab-user-actions">
          <button className="collab-notification-button" onClick={() => setActiveArea('notifications')}>🔔 {unreadCount > 0 && <span>{unreadCount}</span>}</button>
          <div><strong>{user.displayName}</strong><span>{user.role === 'admin' ? '管理员' : user.role === 'manager' ? '经理' : user.role === 'purchaser' ? '采购员' : '查看者'}</span></div>
          <button className="btn btn-outline btn-sm" onClick={logout}>退出</button>
        </div>
      </header>
      <nav className="collab-main-nav">
        <button className={activeArea === 'documents' ? 'active' : ''} onClick={() => setActiveArea('documents')}>资料中心</button>
        <button className={activeArea === 'dashboard' ? 'active' : ''} onClick={() => { setActiveArea('dashboard'); setSearchQuery(''); }}>工作台</button>
        <button className={activeArea === 'tasks' ? 'active' : ''} onClick={() => setActiveArea('tasks')}>共享询价任务</button>
        {['admin', 'manager'].includes(user.role) && <button className={activeArea === 'external' ? 'active' : ''} onClick={() => setActiveArea('external')}>外部接收箱</button>}
        <button className={activeArea === 'templates' ? 'active' : ''} onClick={() => setActiveArea('templates')}>我的账号模板</button>
        <button className={activeArea === 'legacy' ? 'active' : ''} onClick={() => setActiveArea('legacy')}>Excel工具</button>
        {user.role === 'admin' && <button className={activeArea === 'users' ? 'active' : ''} onClick={() => setActiveArea('users')}>账号管理</button>}
        <button className={activeArea === 'database' ? 'active' : ''} onClick={() => setActiveArea('database')}>数据库</button>
      </nav>
      <main className={`collab-shell-main ${activeArea === 'legacy' ? 'legacy-mode' : ''}`}>
        {activeArea === 'dashboard' && <Dashboard onNavigate={setActiveArea} />}
        {activeArea === 'tasks' && <CollaborationWorkspace user={user} onNotificationsChanged={loadNotifications} onOpenExcelTool={() => setActiveArea('legacy')} searchQuery={searchQuery} />}
        {activeArea === 'external' && <ExternalInbox onChanged={loadNotifications} />}
        {activeArea === 'documents' && <DocumentCenter />}
        {activeArea === 'templates' && <RemoteTemplates user={user} />}
        {activeArea === 'legacy' && <App />}
        {activeArea === 'users' && user.role === 'admin' && <AccountAdmin />}
        {activeArea === 'database' && <DatabaseBrowser />}
        {activeArea === 'notifications' && (
          <section className="card collab-notification-panel">
            <div className="card-header"><h2 className="card-title">通知中心</h2><button className="btn btn-outline btn-sm" onClick={loadNotifications}>刷新</button></div>
            {notifications.length === 0 ? <div className="empty-state"><div className="empty-state-text">暂无通知</div></div> : notifications.map(item => (
              <button key={item.id} className={`collab-notification-row ${item.isRead ? 'read' : ''}`} onClick={async () => {
                if (!item.isRead) await window.electronAPI.collaboration.readNotification(item.id);
                await loadNotifications();
                if (item.taskId) setActiveArea('tasks');
              }}>
                <strong>{item.title}</strong><span>{item.message}</span><time>{new Date(item.createdAt).toLocaleString()}</time>
              </button>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
