import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';

const categoryKeys = [
  ['all', 'allDocuments'], ['quotation', 'quotation'], ['quote-comparison', 'quoteComparison'],
  ['supplier-reserve', 'supplierReserve'], ['product-code', 'productCode'], ['task-attachments', 'taskAttachments'],
  ['templates', 'templatesCategory'], ['other', 'otherDocuments']
];

function formatSize(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value, language) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(language || 'zh-CN', { hour12: false });
}

export default function DocumentCenter() {
  const { language, t } = useI18n();
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
    } catch (e) { setError(e.message || t('loadError')); }
    finally { setBusy(false); }
  }, [query, category, t]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    setMessage(''); setError('');
    try {
      const result = await window.electronAPI.collaboration.uploadDocument({ category: category === 'all' ? '' : category });
      if (!result?.canceled && !result?.error) { setMessage(t('uploadSuccess')); await load(); }
      if (result?.error) setError(result.error);
    } catch (e) { setError(e.message || t('uploadError')); }
  };

  const download = async document => {
    try { await window.electronAPI.collaboration.downloadDocument(document); setMessage(t('downloadReady', { name: document.originalName })); }
    catch (e) { setError(e.message || t('downloadError')); }
  };

  const remove = async document => {
    if (!window.confirm(t('deleteConfirm', { name: document.originalName }))) return;
    try { await window.electronAPI.collaboration.deleteDocument(document.id); await load(); setMessage(t('deleteSuccess')); }
    catch (e) { setError(e.message || t('deleteError')); }
  };

  const dynamicCategories = useMemo(() => {
    const values = new Map(categoryKeys.map(([value, key]) => [value, t(key)]));
    documents.forEach(document => {
      const value = document.archiveCategory || document.category;
      if (value && !values.has(value)) values.set(value, value);
    });
    return [...values.entries()];
  }, [documents, t]);

  const groups = useMemo(() => {
    const result = new Map();
    documents.forEach(document => {
      const categoryName = document.archiveCategory || document.category || t('uncategorized');
      const date = String(document.archiveDate || document.createdAt || '').slice(0, 10) || t('noDate');
      const folder = document.archiveFolder || `${date.replace(/-/g, '').slice(4, 8)}-${document.archiveName || document.originalName}`;
      const key = `${categoryName}\u0000${date}\u0000${folder}`;
      if (!result.has(key)) result.set(key, { key, categoryName, date, folder, documents: [] });
      result.get(key).documents.push(document);
    });
    return [...result.values()].sort((a, b) => `${b.date}${b.folder}`.localeCompare(`${a.date}${a.folder}`));
  }, [documents, t]);

  return (
    <section className="document-center">
      <div className="card-header document-center-header">
        <div><div className="text-sm text-muted">{t('resourceCenter')}</div><h1>{t('sharedLibrary')}</h1><p className="text-muted">{t('archiveDescription')}</p></div>
        <button className="btn btn-primary" onClick={upload}>＋{t('uploadDocument')}</button>
      </div>
      <div className="document-toolbar">
        <input className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchDocuments')} />
        <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>{dynamicCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className="btn btn-outline" onClick={load} disabled={busy}>{busy ? t('refreshing') : t('refresh')}</button>
      </div>
      {(message || error) && <div className={error ? 'collab-form-error' : 'collab-form-success'}>{error || message}</div>}
      <div className="document-summary"><span>{t('documentCount', { count: documents.length })}</span><span className="text-muted">{t('autoArchiveNote')}</span></div>
      <div className="document-archive-tree">
        {groups.map(group => {
          const isExpanded = expanded[group.key] !== false;
          return <section className="document-archive-group" key={group.key}>
            <button className="document-archive-folder" onClick={() => setExpanded(value => ({ ...value, [group.key]: !isExpanded }))}><span>{isExpanded ? '▼' : '▶'} {group.categoryName} / {group.date} / {group.folder}</span><span>{t('fileCount', { count: group.documents.length })}</span></button>
            {isExpanded && <div className="document-grid">{group.documents.map(document => <article className="document-card" key={document.id}>
              <div className="document-icon">{['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(String(document.fileExt).toLowerCase()) ? '🖼' : '📄'}</div>
              <div className="document-main"><h3 title={document.originalName}>{document.originalName}</h3><div className="document-meta"><span>{document.archiveCategory || document.category || t('uncategorized')}</span><span>{formatSize(document.fileSize)}</span><span>v{document.versionNo || 1}</span></div><div className="document-meta text-muted"><span>{document.createdByName || '—'}</span><span>{formatDate(document.createdAt, language)}</span></div></div>
              <div className="document-actions"><button className="btn btn-outline btn-sm" onClick={() => download(document)}>{t('download')}</button><button className="btn btn-ghost btn-sm" onClick={() => remove(document)}>{t('moveToRecycle')}</button></div>
            </article>)}</div>}
          </section>;
        })}
      </div>
      {!busy && documents.length === 0 && <div className="empty-state"><div className="empty-state-icon">🗂</div><h3>{query ? t('noMatchingDocuments') : t('noDocuments')}</h3><p>{t('uploadToCreateArchive')}</p></div>}
    </section>
  );
}
