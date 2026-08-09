import React, { useCallback, useEffect, useMemo, useState } from 'react';

const categories = [
  ['all', '全部资料'], ['rfq', '询价单'], ['quote', '报价/对比表'], ['supplier', '供应商资料'],
  ['product', '产品资料'], ['attachment', '任务附件'], ['template', '模板'], ['other', '其他']
];

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
      const result = await window.electronAPI.collaboration.uploadDocument({ category: category === 'all' ? 'other' : category });
      if (!result?.canceled) { setMessage('资料已归档'); await load(); }
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

  const emptyText = useMemo(() => query ? '没有找到匹配资料' : '资料中心还没有文件', [query]);

  return (
    <section className="document-center">
      <div className="card-header document-center-header">
        <div><div className="text-sm text-muted">LATIC 资料中心</div><h1>共享资料库</h1><p className="text-muted">询价单、供应商资料、附件和生成文件统一归档，按权限查看。</p></div>
        <button className="btn btn-primary" onClick={upload}>＋上传资料</button>
      </div>
      <div className="document-toolbar">
        <input className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件名或关联业务…" />
        <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
          {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="btn btn-outline" onClick={load} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button>
      </div>
      {(message || error) && <div className={error ? 'collab-form-error' : 'collab-form-success'}>{error || message}</div>}
      <div className="document-summary"><span>共 {documents.length} 份资料</span><span className="text-muted">文件本体由服务端统一保存，客户端只通过 API 访问</span></div>
      <div className="document-grid">
        {documents.map(document => (
          <article className="document-card" key={document.id}>
            <div className="document-icon">{['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(String(document.fileExt).toLowerCase()) ? '🖼' : '📄'}</div>
            <div className="document-main"><h3 title={document.originalName}>{document.originalName}</h3><div className="document-meta"><span>{categories.find(([value]) => value === document.category)?.[1] || '其他'}</span><span>{formatSize(document.fileSize)}</span><span>v{document.versionNo || 1}</span></div><div className="document-meta text-muted"><span>{document.createdByName || '—'}</span><span>{formatDate(document.createdAt)}</span></div></div>
            <div className="document-actions"><button className="btn btn-outline btn-sm" onClick={() => download(document)}>下载</button><button className="btn btn-ghost btn-sm" onClick={() => remove(document)}>移入回收站</button></div>
          </article>
        ))}
      </div>
      {!busy && documents.length === 0 && <div className="empty-state"><div className="empty-state-icon">🗂</div><h3>{emptyText}</h3><p>可以上传 PDF、图片、Excel、Word 等常用资料。</p></div>}
    </section>
  );
}
