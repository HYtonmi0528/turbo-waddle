import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

function cleanError(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
}

export default function ExternalInbox({ onChanged, user }) {
  const { t, language } = useI18n();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.electronAPI.collaboration.listExternalSubmissions();
      setSubmissions(result?.submissions || []);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const accept = async submission => {
    setBusyId(submission.id);
    setError('');
    try {
      await window.electronAPI.collaboration.acceptExternalSubmission(submission.id, {});
      setMessage(t('externalAccepted', { name: submission.title }));
      await load();
      onChanged?.();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusyId('');
    }
  };

  const reject = async submission => {
    const reason = window.prompt(t('rejectReason'), '') ?? '';
    setBusyId(submission.id);
    setError('');
    try {
      await window.electronAPI.collaboration.rejectExternalSubmission(submission.id, reason);
      setMessage(t('externalRejected', { name: submission.title }));
      await load();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="card external-inbox">
      <div className="card-header">
        <div>
          <h2 className="card-title">{user?.role === 'viewer' ? t('myRfqs') : t('externalInboxTitle')}</h2>
          <p className="text-muted text-sm">{user?.role === 'viewer' ? t('myRfqsHint') : t('externalInboxHint')}</p>
        </div>
        <button className="btn btn-outline" onClick={load} disabled={loading}>{t('refresh')}</button>
      </div>
      {error && <div className="collab-form-error">{error}</div>}
      {message && <div className="collab-form-success">{message}</div>}
      {loading ? <div className="collab-loading">{t('loadingExternal')}</div> : submissions.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📥</div><div className="empty-state-text">{t('noExternal')}</div><div className="empty-state-desc">{t('noExternalHint')}</div></div>
      ) : (
        <div className="table-container external-inbox-table">
          <table className="data-table">
            <thead><tr><th>{t('status')}</th><th>{t('rfqName')}</th><th>{t('country')}</th><th>{t('requester')}</th><th>{t('productCount')}</th><th>{t('receivedAt')}</th><th>{t('taskNumber')}</th><th>{t('actions')}</th></tr></thead>
            <tbody>{submissions.map(item => (
              <tr key={item.id}>
                <td><span className={`collab-status status-${item.status}`}>{t(`externalStatus_${item.taskStatus === 'submitted' ? 'ready' : item.status}`)}</span></td>
                <td><strong>{item.title}</strong><span className="text-sm text-muted external-file-name">{item.originalName}</span></td>
                <td>{item.country || '—'}</td>
                <td>{item.requester || '—'}</td>
                <td>{item.itemCount ?? '—'}</td>
                <td>{item.receivedAt ? new Date(item.receivedAt).toLocaleString(language) : '—'}</td>
                <td>{item.taskId || t('notGenerated')}</td>
                <td>{item.status === 'received' && user?.role === 'manager' && <div className="external-actions"><button className="btn btn-primary btn-sm" disabled={busyId === item.id} onClick={() => accept(item)}>{t('acceptAndDispatch')}</button><button className="btn btn-outline btn-sm" disabled={busyId === item.id} onClick={() => reject(item)}>{t('reject')}</button></div>}{user?.role === 'viewer' && ['submitted', 'completed'].includes(item.taskStatus) && <a className="btn btn-primary btn-sm" href={`/api/external/rfqs/${encodeURIComponent(item.id)}/result`}>{t('downloadResult')}</a>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
