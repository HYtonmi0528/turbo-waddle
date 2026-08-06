import React, { useEffect, useState } from 'react';

const ROLE_LABELS = { admin: '管理员', manager: '经理', purchaser: '采购员', viewer: '查看者' };
const ROLE_LIST = ['viewer', 'purchaser', 'manager', 'admin'];

export default function AccountAdmin() {
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await window.electronAPI.collaboration.listUsers();
    setUsers(result.users || []);
  };

  useEffect(() => { load(); }, []);

  const changeStatus = async (user, status) => {
    await window.electronAPI.collaboration.updateUserStatus(user.id, status);
    setMessage(`${user.displayName} 已${status === 'active' ? '启用' : '停用'}`);
    await load();
  };

  const changeRole = async (user, role) => {
    await window.electronAPI.collaboration.updateUserRole(user.id, role);
    setMessage(`${user.displayName} 已设为${ROLE_LABELS[role]}`);
    await load();
  };

  return (
    <section className="card">
      <div className="card-header"><div><h2 className="card-title">员工账号管理</h2><p className="text-muted text-sm">管理员：全部权限 | 经理：审核+管理任务 | 采购员：录入数据 | 查看者：只看</p></div><button className="btn btn-outline" onClick={load}>刷新</button></div>
      {message && <div className="collab-form-success">{message}</div>}
      <div className="table-container collab-account-table">
        <table className="data-table">
          <thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
          <tbody>{users.map(user => (
            <tr key={user.id}>
              <td>{user.displayName}</td><td>{user.username}</td><td>{ROLE_LABELS[user.role] || user.role}</td>
              <td><span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-primary'}`}>{user.status === 'active' ? '已启用' : user.status === 'pending' ? '待审核' : '已停用'}</span></td>
              <td>{new Date(user.createdAt).toLocaleString()}</td>
              <td className="collab-account-actions">
                {user.status === 'active' && (
                  <select className="form-select" style={{width:'auto',display:'inline-block'}} value={user.role} onChange={e => changeRole(user, e.target.value)}>
                    {ROLE_LIST.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
                {user.role !== 'admin' && (user.status === 'active'
                  ? <button className="btn btn-danger btn-sm" onClick={() => changeStatus(user, 'disabled')}>停用</button>
                  : <button className="btn btn-success btn-sm" onClick={() => changeStatus(user, 'active')}>启用</button>)}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
