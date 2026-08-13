import React, { useCallback, useEffect, useMemo, useState } from 'react';

const baseCategories = [['all', '全部资料'], ['询价表', '询价表'], ['报价/对比表', '报价/对比表'], ['供应商储备', '供应商储备'], ['产品代码表', '产品代码表'], ['任务附件', '任务附件'], ['模板', '模板'], ['其他资料', '其他资料']];

function formatSize(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

export default function DocumentCenter() {
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI.collaboration.listDocuments({ query, category, pageSize: 100 });
      setDocuments(result.documents || []);
    } catch (e) { setError(e.message || '资料加载失败'); }
    finally { setBusy(false); }
  }, [query, category]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    setMessage(''); setError('');
    try {
      const result = await window.electronAPI.collaboration.uploadDocument({ category: category === 'all' ? '' : category });
      if (!result?.canceled && !result?.error) { setMessage('资料已归档'); await load(); }
      if (result?.error) setError(result.error);
    } catch (e) { setError(e.message || '资料上传失败'); }
  };

  const download = async document => {
    try { await window.electronAPI.collaboration.downloadDocument(document); setMessage(`已准备下载：${document.originalName}`); }
    catch (e) { setError(e.message || '资料下载失败'); }
  };

  const remove = async document => {
    if (!window.confirm(`确定将“${document.originalName}”移入回收站吗？`)) return;
    try { await window.electronAPI.collaboration.deleteDocument(document.id); await load(); setMessage('资料已移入回收站'); }
    catch (e) { setError(e.message || '删除失败'); }
  };

  const dynamicCategories = useMemo(() => {
    const values = new Map(baseCategories);
    documents.forEach(document => {
      const value = document.archiveCategory || document.category;
      if (value && !values.has(value)) values.set(value, value);
    });
    return [...values.entries()];
  }, [documents]);

  const groups = useMemo(() => {
    const result = new Map();
    documents.forEach(document => {
      const categoryName = document.archiveCategory || document.category || '其他资料';
      const date = String(document.archiveDate || document.createdAt || '').slice(0, 10) || '未注明日期';
      const folder = document.archiveFolder || `${date.replace(/-/g, '').slice(4, 8)}-${document.archiveName || document.originalName}`;
      const key = `${categoryName}\u0000${date}\u0000${folder}`;
      if (!result.has(key)) result.set(key, { key, categoryName, date, folder, documents: [] });
      result.get(key).documents.push(document);
    });
    return [...result.values()].sort((a, b) => `${b.date}${b.folder}`.localeCompare(`${a.date}${a.folder}`));
  }, [documents]);

  return (
    <section className="document-center">
      <div className="card-header document-center-header">
        <div><div className="text-sm text-muted">LATIC 资料中心</div><h1>共享资料库</h1><p className="text-muted">文件上传后按“资料类型 / 日期 / 业务文件”自动归档；新类型会自动出现，不生成空目录。</p></div>
        <button className="btn btn-primary" onClick={upload}>＋上传资料</button>
      </div>
      <div className="document-toolbar">
        <input className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件名或关联业务" />
        <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>{dynamicCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className="btn btn-outline" onClick={load} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button>
      </div>
      {(message || error) && <div className={error ? 'collab-form-error' : 'collab-form-success'}>{error || message}</div>}
      <div className="document-summary"><span>共 {documents.length} 份资料</span><span className="text-muted">资料分类根据实际上传内容自动建立</span></div>
      <div className="document-archive-tree">
        {groups.map(group => {
          const isExpanded = expanded[group.key] !== false;
          return <section className="document-archive-group" key={group.key}>
            <button className="document-archive-folder" onClick={() => setExpanded(value => ({ ...value, [group.key]: !isExpanded }))}><span>{isExpanded ? '▾' : '▸'} {group.categoryName} / {group.date} / {group.folder}</span><span>{group.documents.length} 个文件</span></button>
            {isExpanded && <div className="document-grid">{group.documents.map(document => <article className="document-card" key={document.id}>
              <div className="document-icon">{['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(String(document.fileExt).toLowerCase()) ? '🖼' : '📄'}</div>
              <div className="document-main"><h3 title={document.originalName}>{document.originalName}</h3><div className="document-meta"><span>{document.archiveCategory || document.category || '其他资料'}</span><span>{formatSize(document.fileSize)}</span><span>v{document.versionNo || 1}</span></div><div className="document-meta text-muted"><span>{document.createdByName || '—'}</span><span>{formatDate(document.createdAt)}</span></div></div>
              <div className="document-actions"><button className="btn btn-outline btn-sm" onClick={() => download(document)}>下载</button><button className="btn btn-ghost btn-sm" onClick={() => remove(document)}>移入回收站</button></div>
            </article>)}</div>}
          </section>;
        })}
      </div>
      {!busy && documents.length === 0 && <div className="empty-state"><div className="empty-state-icon">🗂</div><h3>{query ? '没有找到匹配资料' : '资料中心还没有文件'}</h3><p>上传文件后系统会根据你选择或填写的资料类型自动建立归档目录。</p></div>}
    </section>
  );
}
