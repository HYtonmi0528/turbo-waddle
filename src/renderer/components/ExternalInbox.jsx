import React, { useEffect, useState } from 'react';

const STATUS = { received: '待国内处理', accepted: '已转为任务', rejected: '已拒绝' };

function cleanError(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
}

export default function ExternalInbox({ onChanged }) {
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
      setMessage(`“${submission.title}”已转为国内协作任务`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusyId('');
    }
  };

  const reject = async submission => {
    const reason = window.prompt('请输入拒绝原因（可选）：', '') ?? '';
    setBusyId(submission.id);
    setError('');
    try {
      await window.electronAPI.collaboration.rejectExternalSubmission(submission.id, reason);
      setMessage(`“${submission.title}”已拒绝`);
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
          <h2 className="card-title">外部询价接收箱</h2>
          <p className="text-muted text-sm">海外端只负责提交询价表；管理员确认后才会下发到国内协作任务。</p>
        </div>
        <button className="btn btn-outline" onClick={load} disabled={loading}>刷新</button>
      </div>
      {error && <div className="collab-form-error">{error}</div>}
      {message && <div className="collab-form-success">{message}</div>}
      {loading ? <div className="collab-loading">正在加载接收箱…</div> : submissions.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📥</div><div className="empty-state-text">暂无外部询价</div><div className="empty-state-desc">海外端提交后，询价表会先出现在这里。</div></div>
      ) : (
        <div className="table-container external-inbox-table">
          <table className="data-table">
            <thead><tr><th>状态</th><th>询价名称</th><th>国家</th><th>请求人</th><th>产品数</th><th>接收时间</th><th>任务编号</th><th>操作</th></tr></thead>
            <tbody>{submissions.map(item => (
              <tr key={item.id}>
                <td><span className={`collab-status status-${item.status}`}>{STATUS[item.status] || item.status}</span></td>
                <td><strong>{item.title}</strong><span className="text-sm text-muted external-file-name">{item.originalName}</span></td>
                <td>{item.country || '—'}</td>
                <td>{item.requester || '—'}</td>
                <td>{item.itemCount ?? '—'}</td>
                <td>{item.receivedAt ? new Date(item.receivedAt).toLocaleString() : '—'}</td>
                <td>{item.taskId || '待生成'}</td>
                <td>{item.status === 'received' && <div className="external-actions"><button className="btn btn-primary btn-sm" disabled={busyId === item.id} onClick={() => accept(item)}>接受并下发</button><button className="btn btn-outline btn-sm" disabled={busyId === item.id} onClick={() => reject(item)}>拒绝</button></div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
