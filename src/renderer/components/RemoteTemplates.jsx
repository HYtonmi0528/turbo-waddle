import React, { useEffect, useState } from 'react';

export default function RemoteTemplates({ user }) {
  const [remoteTemplates, setRemoteTemplates] = useState([]);
  const [allShared, setAllShared] = useState([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [my, shared] = await Promise.all([
      window.electronAPI.collaboration.listRemoteTemplates(),
      window.electronAPI.templates.listShared ? window.electronAPI.templates.listShared() : Promise.resolve([])
    ]);
    setRemoteTemplates(my.templates || []);
    setAllShared(shared || []);
  };
  useEffect(() => { load(); }, []);

  const toggleShare = async (template) => {
    await window.electronAPI.collaboration.saveRemoteTemplate({
      id: template.id, name: template.name, type: template.type,
      description: template.description, isShared: !template.isShared
    });
    setMessage(`"${template.name}" 已${template.isShared ? '取消共享' : '设为共享'}`);
    await load();
  };

  const copyTemplate = async (template) => {
    await window.electronAPI.collaboration.saveRemoteTemplate({
      name: template.name + ' (副本)', type: template.type,
      description: template.description, structure: template.structure,
      mappings: template.mappings
    });
    setMessage(`已复制 "${template.name}" 到我的账号`);
    await load();
  };

  return (
    <div className="collab-template-layout">
      <section className="card">
        <div className="card-header"><div><h2 className="card-title">我的模板</h2></div><button className="btn btn-outline" onClick={load}>刷新</button></div>
        {message && <div className="collab-form-success">{message}</div>}
        {remoteTemplates.length === 0 ? <div className="empty-state"><div className="empty-state-text">还没有模板记录</div></div> : (
          <div className="template-grid">{remoteTemplates.map(template => (
            <div className="template-card" key={template.id}>
              <div className="template-card-name">{template.name}</div>
              <span className="template-card-type">{template.type}</span>
              <p className="template-card-desc">{template.description || '无说明'}</p>
              <div className="template-card-actions">
                <span className="text-sm text-muted">{template.isShared ? '已共享' : '个人'}</span>
                <button className="btn btn-outline btn-sm" onClick={() => toggleShare(template)}>{template.isShared ? '取消共享' : '共享'}</button>
              </div>
            </div>
          ))}</div>
        )}
      </section>
      <section className="card">
        <div className="card-header"><h2 className="card-title">团队共享模板</h2></div>
        {allShared.length === 0 ? <div className="empty-state"><div className="empty-state-text">暂无共享模板</div></div> : (
          <div className="template-grid">{allShared.map(template => (
            <div className="template-card" key={template.id}>
              <div className="template-card-name">{template.name}</div>
              <span className="template-card-type">{template.type}</span>
              <span className="text-sm text-muted">{template.ownerName || '未知用户'}</span>
              <button className="btn btn-outline btn-sm" onClick={() => copyTemplate(template)}>复制到我的</button>
            </div>
          ))}</div>
        )}
      </section>
    </div>
  );
}
