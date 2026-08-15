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
  const [preview, setPreview] = useState(null);

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

  const previewDocument = async document => {
    const ext = String(document.fileExt || '').toLowerCase();
    if (!['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'xlsx', 'csv', 'tsv'].includes(ext)) {
      setError(t('previewUnsupported'));
      return;
    }
    try {
      const result = await window.electronAPI.collaboration.previewDocument(document);
      if (result?.filePath && !result?.url) { setMessage(t('previewOpened')); return; }
      setPreview({ document, url: result?.url || `/api/documents/${encodeURIComponent(document.id)}/preview`, kind: ext === 'pdf' ? 'pdf' : ['xlsx', 'csv', 'tsv'].includes(ext) ? 'spreadsheet' : 'image' });
    } catch (e) { setError(e.message || t('previewError')); }
  };

  const renameDocument = async document => {
    const name = window.prompt(t('renamePrompt'), document.originalName || '');
    if (name == null || !name.trim() || name.trim() === document.originalName) return;
    try { await window.electronAPI.collaboration.renameDocument(document.id, { name: name.trim() }); await load(); setMessage(t('renameSuccess')); }
    catch (e) { setError(e.message || t('renameError')); }
  };

  const renameFolder = async group => {
    const name = window.prompt(t('renameFolderPrompt'), group.folder || '');
    if (name == null || !name.trim() || name.trim() === group.folder) return;
    try {
      await window.electronAPI.collaboration.renameDocumentFolder({ archiveCategory: group.categoryName, archiveDate: group.date, archiveFolder: group.folder, newName: name.trim() });
      await load(); setMessage(t('renameFolderSuccess'));
    } catch (e) { setError(e.message || t('renameFolderError')); }
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
            <div className="document-archive-folder"><button className="document-folder-toggle" onClick={() => setExpanded(value => ({ ...value, [group.key]: !isExpanded }))}><span>{isExpanded ? '▼' : '▶'} {group.categoryName} / {group.date} / {group.folder}</span><span>{t('fileCount', { count: group.documents.length })}</span></button><button className="btn btn-ghost btn-sm" onClick={() => renameFolder(group)}>{t('renameFolder')}</button></div>
            {isExpanded && <div className="document-grid">{group.documents.map(document => <article className="document-card" key={document.id}>
              <div className="document-icon">{['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(String(document.fileExt).toLowerCase()) ? '🖼' : ['xlsx', 'csv', 'tsv'].includes(String(document.fileExt).toLowerCase()) ? '📊' : '📄'}</div>
              <div className="document-main"><h3 title={document.originalName}>{document.originalName}</h3><div className="document-meta"><span>{document.archiveCategory || document.category || t('uncategorized')}</span><span>{formatSize(document.fileSize)}</span><span>v{document.versionNo || 1}</span></div><div className="document-meta text-muted"><span>{document.createdByName || '—'}</span><span>{formatDate(document.createdAt, language)}</span></div></div>
              <div className="document-actions"><button className="btn btn-outline btn-sm" onClick={() => previewDocument(document)}>{t('preview')}</button><button className="btn btn-outline btn-sm" onClick={() => download(document)}>{t('download')}</button><button className="btn btn-ghost btn-sm" onClick={() => renameDocument(document)}>{t('rename')}</button><button className="btn btn-ghost btn-sm" onClick={() => remove(document)}>{t('moveToRecycle')}</button></div>
            </article>)}</div>}
          </section>;
        })}
      </div>
      {!busy && documents.length === 0 && <div className="empty-state"><div className="empty-state-icon">🗂</div><h3>{query ? t('noMatchingDocuments') : t('noDocuments')}</h3><p>{t('uploadToCreateArchive')}</p></div>}
      {preview && <div className="document-preview-backdrop" role="dialog" aria-modal="true" onClick={() => setPreview(null)}><div className="document-preview-modal" onClick={event => event.stopPropagation()}><div className="card-header"><h2>{preview.document.originalName}</h2><button className="btn btn-ghost" onClick={() => setPreview(null)}>×</button></div>{preview.kind === 'image' ? <img src={preview.url} alt={preview.document.originalName} /> : <iframe title={preview.document.originalName} src={preview.url} />}</div></div>}
    </section>
  );
}
