import React, { useState, useEffect } from 'react';

export default function HistoryPanel({ showToast }) {
  const [history, setHistory] = useState([]);
  const [savedData, setSavedData] = useState([]);
  const [backups, setBackups] = useState([]);
  const [activeSubTab, setActiveSubTab] = useState('history');
  const [searchTerm, setSearchTerm] = useState('');
  const [isMaintainingDatabase, setIsMaintainingDatabase] = useState(false);

  useEffect(() => {
    loadHistory();
    loadSavedData();
    loadBackups();
  }, []);

  const loadHistory = async () => {
    try {
      const list = await window.electronAPI.history.list();
      setHistory(list || []);
    } catch (e) {
      console.error('加载历史失败:', e);
    }
  };

  const loadSavedData = async () => {
    try {
      const entries = await window.electronAPI.data.getEntries();
      setSavedData((entries || []).map(e => ({
        ...e,
        data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      })));
    } catch (e) {
      console.error('加载数据失败:', e);
    }
  };

  const loadBackups = async () => {
    try {
      const list = await window.electronAPI.database.listBackups();
      setBackups(list || []);
    } catch (e) {
      console.error('加载数据库备份失败:', e);
    }
  };

  const handleCreateBackup = async () => {
    setIsMaintainingDatabase(true);
    try {
      const result = await window.electronAPI.database.createBackup();
      showToast(`数据库已备份：${result.path}`);
      await loadBackups();
    } catch (error) {
      showToast(`数据库备份失败：${error.message}`, 'error');
    } finally {
      setIsMaintainingDatabase(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!confirm('恢复数据库会先自动备份当前数据，然后重启程序。确定继续吗？')) return;
    setIsMaintainingDatabase(true);
    try {
      const result = await window.electronAPI.database.restoreBackup();
      if (result?.canceled) setIsMaintainingDatabase(false);
    } catch (error) {
      showToast(`恢复数据库失败：${error.message}`, 'error');
      setIsMaintainingDatabase(false);
    }
  };

  const handleOpenBackupFolder = async () => {
    const result = await window.electronAPI.database.openBackupFolder();
    if (!result?.success) showToast(result?.message || '无法打开备份文件夹', 'error');
  };

  const handleDeleteHistory = async (id) => {
    try {
      await window.electronAPI.data.deleteEntry(id);
      showToast('记录已删除');
      loadSavedData();
    } catch (e) {
      showToast('删除失败', 'error');
    }
  };

  const filteredData = savedData.filter(entry => {
    if (!searchTerm) return true;
    const data = entry.data || {};
    const searchLower = searchTerm.toLowerCase();
    return (
      (data.supplierName || '').toLowerCase().includes(searchLower) ||
      (data.productName || '').toLowerCase().includes(searchLower) ||
      (data.model || '').toLowerCase().includes(searchLower)
    );
  });

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">历史记录与数据管理</h2>
          <div className="flex-center gap-8">
            <button
              className={`btn btn-sm ${activeSubTab === 'history' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveSubTab('history')}
            >
              生成历史
            </button>
            <button
              className={`btn btn-sm ${activeSubTab === 'data' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveSubTab('data')}
            >
              已保存数据 ({savedData.length})
            </button>
            <button
              className={`btn btn-sm ${activeSubTab === 'backups' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveSubTab('backups')}
            >
              数据库备份 ({backups.length})
            </button>
          </div>
        </div>

        {activeSubTab === 'history' && (
          <>
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <div className="empty-state-text">暂无生成记录</div>
                <div className="empty-state-desc">生成Excel文件后，记录将显示在此处</div>
              </div>
            ) : (
              <div>
                {history.map((item) => (
                  <div key={item.id} className="history-item">
                    <div className="history-info">
                      <div style={{ fontSize: '24px' }}>
                        {item.template_name?.includes('询价') ? '📋' :
                         item.template_name?.includes('报价') ? '💰' :
                         item.template_name?.includes('对比') ? '📊' : '📄'}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                          {item.template_name || '未知模板'}
                        </div>
                        <div className="text-sm text-muted">
                          {(() => {
                            try {
                              const summary = typeof item.data_summary === 'string'
                                ? JSON.parse(item.data_summary)
                                : item.data_summary;
                              return typeof summary === 'string' ? summary : summary?.join(', ') || '';
                            } catch { return item.data_summary || ''; }
                          })()}
                        </div>
                        <div className="history-date">
                          {new Date(item.created_at).toLocaleString('zh-CN')}
                        </div>
                      </div>
                    </div>
                    <div className="flex-center gap-8">
                      <span className="text-sm text-muted" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.file_path || ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeSubTab === 'data' && (
          <>
            <div className="mb-12">
              <input
                className="form-input"
                placeholder="搜索供应商、产品或型号..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ maxWidth: '400px' }}
              />
            </div>

            {filteredData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💾</div>
                <div className="empty-state-text">暂无保存的数据</div>
                <div className="empty-state-desc">
                  {searchTerm ? '未找到匹配的数据' : '生成Excel时填写的数据会自动保存'}
                </div>
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: '500px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>供应商</th>
                      <th>产品名称</th>
                      <th>型号</th>
                      <th>价格</th>
                      <th>成本</th>
                      <th>保存时间</th>
                      <th style={{ width: '60px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.map(entry => (
                      <tr key={entry.id}>
                        <td>{entry.data?.supplierName || '-'}</td>
                        <td>{entry.data?.productName || '-'}</td>
                        <td>{entry.data?.model || '-'}</td>
                        <td>{entry.data?.price ? `¥${entry.data.price}` : '-'}</td>
                        <td>{entry.data?.cost ? `¥${entry.data.cost}` : '-'}</td>
                        <td className="text-sm text-muted">
                          {new Date(entry.updated_at || entry.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteHistory(entry.id)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeSubTab === 'backups' && (
          <div>
            <div className="flex-center gap-8 mb-12" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleCreateBackup} disabled={isMaintainingDatabase}>
                {isMaintainingDatabase ? '处理中…' : '立即备份'}
              </button>
              <button className="btn btn-outline" onClick={handleRestoreBackup} disabled={isMaintainingDatabase}>
                从备份恢复
              </button>
              <button className="btn btn-outline" onClick={handleOpenBackupFolder}>
                打开备份文件夹
              </button>
            </div>
            <p className="text-sm text-muted mb-12">
              程序每天首次启动时自动备份数据库，并保留最近 {10} 份；恢复前还会额外保存当前数据库。
            </p>
            {backups.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px' }}>
                <div className="empty-state-icon">🗄️</div>
                <div className="empty-state-text">暂无数据库备份</div>
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: '420px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>备份文件</th>
                      <th>备份时间</th>
                      <th>大小</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map(backup => (
                      <tr key={backup.path}>
                        <td title={backup.path}>{backup.name}</td>
                        <td>{new Date(backup.modifiedAt).toLocaleString('zh-CN')}</td>
                        <td>{(backup.size / 1024).toFixed(1)} KB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
