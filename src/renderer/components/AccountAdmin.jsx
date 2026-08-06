import React, { useEffect, useState } from 'react';

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

  return (
    <section className="card">
      <div className="card-header"><div><h2 className="card-title">员工账号管理</h2><p className="text-muted text-sm">新注册员工需要管理员启用后才能登录。</p></div><button className="btn btn-outline" onClick={load}>刷新</button></div>
      {message && <div className="collab-form-success">{message}</div>}
      <div className="table-container collab-account-table">
        <table className="data-table">
          <thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
          <tbody>{users.map(user => (
            <tr key={user.id}>
              <td>{user.displayName}</td><td>{user.username}</td><td>{user.role === 'admin' ? '管理员' : '普通员工'}</td>
              <td><span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-primary'}`}>{user.status === 'active' ? '已启用' : user.status === 'pending' ? '待审核' : '已停用'}</span></td>
              <td>{new Date(user.createdAt).toLocaleString()}</td>
              <td>{user.role !== 'admin' && (user.status === 'active'
                ? <button className="btn btn-danger btn-sm" onClick={() => changeStatus(user, 'disabled')}>停用</button>
                : <button className="btn btn-success btn-sm" onClick={() => changeStatus(user, 'active')}>启用</button>)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

