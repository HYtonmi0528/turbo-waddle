import React, { useState, useEffect, useCallback, useRef } from 'react';
import DataEntryForm from './components/DataEntryForm';
import TemplateManager from './components/TemplateManager';
import TemplateEditor from './components/TemplateEditor';
import FieldMapping from './components/FieldMapping';
import HistoryPanel from './components/HistoryPanel';
import { CURRENT_RELEASE_NOTES } from './utils/releaseNotes';
import appLogo from '../../assets/app-logo.png';

const TABS = [
  { key: 'generate', label: '数据录入与生成' },
  { key: 'templates', label: '模板管理' },
  { key: 'editor', label: '模板编辑器' },
  { key: 'mapping', label: '字段映射' },
  { key: 'history', label: '历史记录' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('generate');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedTemplateForMapping, setSelectedTemplateForMapping] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSplash, setShowSplash] = useState(true);
  const [appVersion, setAppVersion] = useState('1.1.0-beta.3');
  const [updateStatus, setUpdateStatus] = useState({ state: 'idle', percent: 0 });
  const [releaseNotesModal, setReleaseNotesModal] = useState(null);
  const announcedVersionRef = useRef('');
  const appVersionRef = useRef('1.1.0-beta.3');
  const currentReleaseNotesRef = useRef(CURRENT_RELEASE_NOTES.items.join('\n'));

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    // 错误提示显示更长时间
    const duration = type === 'error' ? 5000 : 3000;
    setTimeout(() => setToast(null), duration);
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await window.electronAPI.templates.list();
      setTemplates(list || []);
    } catch (e) {
      console.error('加载模板失败:', e);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    let mounted = true;
    const applyUpdateStatus = next => {
      if (!mounted || !next) return;
      setUpdateStatus(next);

      if (
        next.availableVersion &&
        ['downloading', 'downloaded', 'installing'].includes(next.state) &&
        announcedVersionRef.current !== next.availableVersion
      ) {
        announcedVersionRef.current = next.availableVersion;
        setReleaseNotesModal({
          mode: 'available',
          version: next.availableVersion,
          title: `发现新版本 v${next.availableVersion}`,
          notes: next.releaseNotes || '该版本暂未提供详细更新说明。'
        });
      } else if (next.state === 'installing') {
        setReleaseNotesModal(current => current ? {
          ...current,
          mode: 'available',
          title: `正在自动安装 v${next.availableVersion || current.version}`
        } : current);
      }

      if (next.state === 'downloaded') {
        showToast(next.message, 'success');
      } else if (next.state === 'downloading' && Number(next.percent) === 0) {
        showToast(next.message, 'success');
      } else if (next.state === 'not-available' && !next.silent) {
        showToast(next.message, 'success');
      } else if (next.state === 'error' && !next.silent) {
        showToast(next.message, 'error');
      } else if (next.state === 'unavailable' && !next.silent) {
        showToast(next.message, 'warning');
      }
    };

    const initializeStartupUpdateCheck = async () => {
      const version = await window.electronAPI.app.getVersion();
      if (!mounted || !version) return;
      appVersionRef.current = version;
      setAppVersion(version);

      const pendingNotes = await window.electronAPI.update.getInstalledReleaseNotes();
      if (!mounted) return;
      currentReleaseNotesRef.current = pendingNotes?.notes || CURRENT_RELEASE_NOTES.items.join('\n');
      if (pendingNotes?.notes) {
        setReleaseNotesModal({
          mode: 'installed',
          version,
          title: `已更新到 v${version}`,
          notes: pendingNotes.notes
        });
      }

      const next = await window.electronAPI.update.getStatus();
      if (!mounted || !next) return;
      if (next.state !== 'idle') applyUpdateStatus(next);
      else setUpdateStatus(next);
    };

    const removeListener = window.electronAPI.update.onStatus(applyUpdateStatus);
    initializeStartupUpdateCheck();

    return () => {
      mounted = false;
      removeListener();
    };
  }, [showToast]);

  useEffect(() => {
    if (
      releaseNotesModal?.mode === 'available' &&
      releaseNotesModal.version === updateStatus.availableVersion &&
      updateStatus.releaseNotes &&
      releaseNotesModal.notes !== updateStatus.releaseNotes
    ) {
      setReleaseNotesModal(current => current ? { ...current, notes: updateStatus.releaseNotes } : current);
    }
  }, [releaseNotesModal, updateStatus.availableVersion, updateStatus.releaseNotes]);

  const getReleaseNotesKicker = mode => {
    if (mode === 'installed') return '版本更新完成';
    return '新版本推送';
  };

  const closeReleaseNotes = async () => {
    if (
      releaseNotesModal?.version &&
      releaseNotesModal.version === appVersionRef.current
    ) {
      await window.electronAPI.update.acknowledgeReleaseNotes(releaseNotesModal.version);
    }
    setReleaseNotesModal(null);
  };

  const handleUpdateAction = async () => {
    if (updateStatus.state === 'downloaded') {
      setReleaseNotesModal({
        mode: 'available',
        version: updateStatus.availableVersion,
        title: `新版本 v${updateStatus.availableVersion} 已下载`,
        notes: updateStatus.releaseNotes || '更新已经下载完成，可以立即重启程序进行安装。'
      });
      return;
    }
    const next = await window.electronAPI.update.check();
    if (next) setUpdateStatus(next);
  };

  const getUpdateButtonLabel = () => {
    if (updateStatus.state === 'checking') return '检查中…';
    if (updateStatus.state === 'downloading') return `下载 ${updateStatus.percent || 0}%`;
    if (updateStatus.state === 'downloaded') return '查看更新并安装';
    if (updateStatus.state === 'installing') return '正在自动安装…';
    return '检查更新';
  };

  const installDownloadedUpdate = async () => {
    await window.electronAPI.update.restartAndInstall();
  };

  const renderReleaseNotes = notes => {
    const lines = String(notes || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return <p className="release-notes-empty">本次更新没有提供详细说明。</p>;
    return (
      <ul className="release-notes-list">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{line.replace(/^[-*•]\s*/, '')}</li>
        ))}
      </ul>
    );
  };

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template);
    setActiveTab('generate');
  };

  const handleMappingClick = (template) => {
    setSelectedTemplateForMapping(template);
    setActiveTab('mapping');
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'generate':
        return (
          <DataEntryForm
            templates={templates}
            selectedTemplate={selectedTemplate}
            onTemplateSelect={setSelectedTemplate}
            showToast={showToast}
          />
        );
      case 'templates':
        return (
          <TemplateManager
            templates={templates}
            onRefresh={loadTemplates}
            onSelect={handleTemplateSelect}
            onMappingClick={handleMappingClick}
            showToast={showToast}
          />
        );
      case 'editor':
        return (
          <TemplateEditor
            templates={templates}
            showToast={showToast}
            onRefresh={loadTemplates}
          />
        );
      case 'mapping':
        return (
          <FieldMapping
            templates={templates}
            selectedTemplate={selectedTemplateForMapping}
            showToast={showToast}
          />
        );
      case 'history':
        return <HistoryPanel showToast={showToast} />;
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      {showSplash && (
        <div className="startup-splash">
          <img src={appLogo} alt="LATIC" onAnimationEnd={() => setShowSplash(false)} />
        </div>
      )}

      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <img className="app-brand-logo" src={appLogo} alt="" />
            智能Excel表格生成器
          </h1>
        </div>
        <div className="header-right">
          <button
            className={`update-btn ${updateStatus.state === 'downloaded' ? 'ready' : ''}`}
            onClick={handleUpdateAction}
            disabled={['checking', 'downloading', 'installing'].includes(updateStatus.state)}
            title={updateStatus.message || '从 GitHub 检查新版本'}
          >
            {getUpdateButtonLabel()}
          </button>
          <span className="version-tag">v{appVersion}</span>
        </div>
      </header>

      <nav className="tab-nav">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {renderTabContent()}
      </main>

      {['checking', 'downloading', 'installing'].includes(updateStatus.state) && (
        <div className={`update-status-card update-status-${updateStatus.state}`}>
          <span className="update-status-spinner" />
          <div>
            <strong>
              {updateStatus.state === 'checking' && '正在后台检查更新'}
              {updateStatus.state === 'downloading' && `正在下载新版本 ${updateStatus.percent || 0}%`}
              {updateStatus.state === 'installing' && '正在安装新版本'}
            </strong>
            <span>软件可以继续正常使用</span>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}

      {releaseNotesModal && (
        <div className="modal-overlay release-notes-overlay" onClick={closeReleaseNotes}>
          <div className="modal release-notes-modal" onClick={event => event.stopPropagation()}>
            <div className="release-notes-header">
              <div>
                <div className="release-notes-kicker">
                  {getReleaseNotesKicker(releaseNotesModal.mode)}
                </div>
                <h3 className="modal-title">{releaseNotesModal.title}</h3>
              </div>
              <button className="release-notes-close" onClick={closeReleaseNotes} title="关闭">×</button>
            </div>
            <div className="release-notes-body">
              {renderReleaseNotes(releaseNotesModal.notes)}
              {releaseNotesModal.mode === 'available' && updateStatus.state === 'downloading' && (
                <div className="release-download-status">
                  <div className="release-download-track">
                    <span style={{ width: `${Math.max(0, Math.min(100, updateStatus.percent || 0))}%` }} />
                  </div>
                  <span>正在下载 {updateStatus.percent || 0}%</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={closeReleaseNotes}>
                {releaseNotesModal.mode === 'available' ? '稍后处理' : '我知道了'}
              </button>
              {releaseNotesModal.mode === 'available' && updateStatus.state === 'downloaded' && (
                <button className="btn btn-primary" onClick={installDownloadedUpdate}>
                  立即重启并安装
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
