import React, { useEffect, useState } from 'react';

function StatusCard({ label, count, color, onClick }) {
  return (
    <button className="dashboard-stat-card" onClick={onClick} style={{ borderTopColor: color }}>
      <span className="dash-stat-count">{count}</span>
      <span className="dash-stat-label">{label}</span>
    </button>
  );
}

export default function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState({ byStatus: [], totalItems: 0, filledItems: 0 });
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [statRes, taskRes] = await Promise.all([
          window.electronAPI.collaboration.getTaskStats().catch(() => null),
          window.electronAPI.collaboration.listTasks().catch(() => ({ tasks: [] }))
        ]);
        if (statRes) setStats(statRes);
        setTasks(taskRes.tasks || []);
      } catch (_) {} finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="collab-loading">加载仪表盘…</div>;

  const statusCounts = { published: 0, in_progress: 0, review: 0, completed: 0 };
  tasks.forEach(t => { if (statusCounts.hasOwnProperty(t.status)) statusCounts[t.status]++; });
  const urgent = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date(Date.now() + 86400000) && t.status !== 'completed').length;
  const overdue = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date() && t.status !== 'completed').length;

  const fillPct = stats.totalItems ? Math.round(stats.filledItems / stats.totalItems * 100) : 0;

  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <div><h1>工作台</h1><p>{new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
      </div>
      <div className="dashboard-stats-grid">
        <StatusCard label="进行中" count={statusCounts.in_progress + statusCounts.published} color="#4472C4" onClick={() => onNavigate('tasks')} />
        <StatusCard label="待审核" count={statusCounts.review} color="#F39C12" onClick={() => onNavigate('tasks')} />
        <StatusCard label="已完成" count={statusCounts.completed} color="#27AE60" onClick={() => onNavigate('tasks')} />
        <StatusCard label="近期待办" count={urgent} color="#E74C3C" onClick={() => onNavigate('tasks')} />
      </div>
      <div className="dashboard-row">
        <section className="card dash-progress-card">
          <div className="card-header"><h2 className="card-title">整体填写进度</h2></div>
          <div className="dash-progress-bar">
            <div className="dash-progress-fill" style={{ width: `${fillPct}%` }} />
          </div>
          <span className="text-sm text-muted">{stats.filledItems} / {stats.totalItems} 项已填写 ({fillPct}%)</span>
        </section>
        <section className="card dash-urgent-card">
          <div className="card-header"><h2 className="card-title">最近任务</h2></div>
          {tasks.filter(t => t.status !== 'completed').slice(0, 5).map(t => {
            const isLate = t.deadline && new Date(t.deadline) < new Date();
            const isSoon = t.deadline && new Date(t.deadline) < new Date(Date.now() + 86400000) && !isLate;
            return (
              <button key={t.id} className="dash-task-row" onClick={() => onNavigate('tasks')}>
                <span className={`collab-status status-${t.status}`}>{t.status === 'published' ? '已下发' : t.status === 'in_progress' ? '进行中' : t.status === 'review' ? '待审核' : t.status}</span>
                <strong>{t.title}</strong>
                {t.deadline && <span className={isLate ? 'dash-deadline-late' : isSoon ? 'dash-deadline-soon' : 'text-muted'}>{new Date(t.deadline).toLocaleDateString()}</span>}
              </button>
            );
          })}
          {tasks.filter(t => t.status !== 'completed').length === 0 && <div className="empty-state"><div className="empty-state-text">暂无进行中的任务</div></div>}
        </section>
      </div>
    </div>
  );
}
