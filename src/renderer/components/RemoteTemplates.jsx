import React, { useEffect, useState } from 'react';

export default function RemoteTemplates() {
  const [remoteTemplates, setRemoteTemplates] = useState([]);
  const [localTemplates, setLocalTemplates] = useState([]);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    const [remote, local] = await Promise.all([
      window.electronAPI.collaboration.listRemoteTemplates(),
      window.electronAPI.templates.list()
    ]);
    setRemoteTemplates(remote.templates || []);
    setLocalTemplates(local || []);
  };
  useEffect(() => { load(); }, []);

  const syncTemplate = async template => {
    setBusyId(template.id);
    setMessage('');
    try {
      const [structure, mappings] = await Promise.all([
        window.electronAPI.templates.getStructure(template.id),
        window.electronAPI.fieldMapping.get(template.id)
      ]);
      await window.electronAPI.collaboration.saveRemoteTemplate({
        name: template.name,
        type: template.type,
        description: template.description,
        originalName: template.original_name || template.originalName,
        structure,
        mappings: (mappings || []).map(item => ({ templateField: item.template_field, systemField: item.system_field }))
      });
      setMessage(`“${template.name}”已记录到当前账号。`);
      await load();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="collab-template-layout">
      <section className="card">
        <div className="card-header"><div><h2 className="card-title">当前账号的模板</h2><p className="text-muted text-sm">这些模板记录在MySQL中，按登录账号区分。</p></div><button className="btn btn-outline" onClick={load}>刷新</button></div>
        {message && <div className="collab-form-success">{message}</div>}
        {remoteTemplates.length === 0 ? <div className="empty-state"><div className="empty-state-text">账号中还没有模板记录</div></div> : (
          <div className="template-grid">{remoteTemplates.map(template => (
            <div className="template-card" key={template.id}><div className="template-card-name">{template.name}</div><span className="template-card-type">{template.type}</span><p className="template-card-desc">{template.description || '无说明'}</p><div className="text-sm text-muted">{template.isShared ? '共享模板' : '个人模板'}</div></div>
          ))}</div>
        )}
      </section>
      <section className="card">
        <div className="card-header"><div><h2 className="card-title">本机已有模板</h2><p className="text-muted text-sm">将原程序中的模板登记到当前账号，原文件不会被删除。</p></div></div>
        {localTemplates.length === 0 ? <div className="empty-state"><div className="empty-state-text">本机暂无模板</div></div> : (
          <div className="template-grid">{localTemplates.map(template => (
            <div className="template-card" key={template.id}><div className="template-card-name">{template.name}</div><span className="template-card-type">{template.type}</span><p className="template-card-desc">{template.description || '无说明'}</p><button className="btn btn-primary btn-sm" disabled={busyId === template.id} onClick={() => syncTemplate(template)}>{busyId === template.id ? '同步中…' : '记录到我的账号'}</button></div>
          ))}</div>
        )}
      </section>
    </div>
  );
}
