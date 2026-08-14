import React, { useState } from 'react';
import { useI18n } from '../i18n';

export default function OverseasRfqSubmit() {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    if (!file) return setError(t('chooseRfqFile'));
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await window.electronAPI.collaboration.submitExternalRfq({ title, file });
      setMessage(t('submittedCount', { count: result.itemCount || 0 })); setTitle(''); setFile(null); event.target.reset();
    } catch (e) { setError(e.message || t('submitFailed')); }
    finally { setBusy(false); }
  };
  return <section className="card external-inbox"><div className="card-header"><div><h2 className="card-title">{t('submitRfq')}</h2><p className="text-muted text-sm">{t('overseasSubmitHint')}</p></div></div><form className="collab-import-form" onSubmit={submit}><label className="form-label">{t('rfqName')}<input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('rfqNamePlaceholder')} /></label><label className="form-label">{t('excelFile')}<span className="collab-file-picker"><span className="btn btn-outline">{t('chooseFile')}</span><span className="collab-file-name">{file?.name || t('noFileSelected')}</span><input className="collab-file-input" type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} required /></span></label>{error && <div className="collab-form-error">{error}</div>}{message && <div className="collab-form-success">{message}</div>}<button className="btn btn-primary" disabled={busy}>{busy ? t('submitting') : t('submitRfq')}</button></form></section>;
}
