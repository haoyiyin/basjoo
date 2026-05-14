'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AdminLayout from '../components/AdminLayout';
type AdminRole = 'super_admin' | 'admin' | 'support' | 'readonly';
type AdminUser = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  role: AdminRole;
};

const roleOptions = [
  { value: 'super_admin', label: '超级管理员' },
  { value: 'admin', label: '普通管理员' },
  { value: 'support', label: '客服人员' },
  { value: 'readonly', label: '只读账号' },
] as const;

export const AdminUsers = () => {
  const { token, admin } = useAuth();
  const isSuperAdmin = admin?.role === 'super_admin';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState({email: '',name: '',password: '',is_active: true,role: 'admin' as AdminRole});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [publicRegistrationEnabled, setPublicRegistrationEnabled] = useState(false);


  const authHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

    const loadUsers = async () => {
      if (!isSuperAdmin && admin) {
        setUsers([{
          id: admin.id,
          email: admin.email,
          name: admin.name,
          is_active: true,
          role: admin.role,
        }]);
        return;
      }
    
      const res = await fetch('/api/admin/users', { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '加载用户失败');
      setUsers(data);
    };
  
  const loadRegistrationSettings = async () => {
  const res = await fetch('/api/admin/registration-settings', { headers: authHeaders });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || '加载注册设置失败');
  setPublicRegistrationEnabled(Boolean(data.public_registration_enabled));
};
useEffect(() => {
  if (!token) return;
  loadUsers().catch((err) => setError(err.message));

  if (isSuperAdmin) {
    loadRegistrationSettings().catch((err) => setError(err.message));
  }
}, [token, isSuperAdmin, admin]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email, name, password, role }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.detail || '创建失败');
      return;
    }

    setMessage(`已创建管理员：${data.email}`);
    setEmail('');
    setName('');
    setPassword('');
    setRole('admin');
    await loadUsers();
  };

  const startEdit = (user: AdminUser) => {
    setEditingId(user.id);
    setEditData({email: user.email,name: user.name,password: '',is_active: user.is_active,role: user.role});
  };

  const saveEdit = async (id: number) => {
    setMessage('');
    setError('');

    const payload: Record<string, unknown> = {
      email: editData.email,
      name: editData.name,
      is_active: editData.is_active,
      role: editData.role,
    };

    if (editData.password.trim()) {
      payload.password = editData.password;
    }

    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.detail || '保存失败');
      return;
    }

    setEditingId(null);
    setMessage('用户已更新');
    await loadUsers();
  };

  const deleteUser = async (id: number) => {
    if (!window.confirm('确定删除这个管理员账号吗？')) return;

    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || '删除失败');
      return;
    }

    setMessage('用户已删除');
    await loadUsers();
  };

  const updateRegistrationSetting = async (enabled: boolean) => {
  setMessage('');
  setError('');

  const res = await fetch('/api/admin/registration-settings', {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ public_registration_enabled: enabled }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setError(data.detail || '保存注册设置失败');
    return;
  }

  setPublicRegistrationEnabled(Boolean(data.public_registration_enabled));
  setMessage(enabled ? '公开注册已开启' : '公开注册已关闭');
};
  return (
  <AdminLayout>
    <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          用户管理
        </h1>
      </div>

      {message && <div style={{ color: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>{message}</div>}
      {error && <div style={{ color: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>{error}</div>}
       {isSuperAdmin && (<div className="glass-card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-6)',
          }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
                注册设置
              </h2>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
                控制登录页是否显示注册入口，并决定是否允许公开注册管理员账号。
              </p>
            </div>
        
            <button
              type="button"
              onClick={() => updateRegistrationSetting(!publicRegistrationEnabled)}
              style={{
                minWidth: 132,
                padding: '10px 16px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                color: 'var(--color-text-inverse)',
                background: publicRegistrationEnabled
                  ? 'var(--color-accent-gradient)'
                  : 'var(--color-text-muted)',
              }}
            >
              {publicRegistrationEnabled ? '已开启' : '已关闭'}
            </button>
          </div>
        </div>
       )}
      {isSuperAdmin && (<div className="glass-card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-5)' }}>添加管理员</h2>
        <form onSubmit={createUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 180px auto', gap: 'var(--space-4)', alignItems: 'end' }}>
          <label>邮箱<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>姓名<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>密码<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label>角色<select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>{roleOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>
    ))}
  </select>
</label>
          <button type="submit">创建</button>
        </form>
      </div>
	)}
      <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-5)' }}>管理员列表</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '12px' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>邮箱</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>姓名</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>角色</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>状态</th>
               {isSuperAdmin && <th style={{ textAlign: 'right', padding: '12px' }}>操作</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '12px' }}>{user.id}</td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? <input value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} /> : user.email}</td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? <input value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} /> : user.name}</td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? (<select value={editData.role} onChange={(e) => setEditData({ ...editData, role: e.target.value as AdminRole })}>
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    roleOptions.find((option) => option.value === user.role)?.label || user.role
                  )}
                </td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? <label><input type="checkbox" checked={editData.is_active} onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })} /> 启用</label> : user.is_active ? '启用' : '禁用'}</td>
                 {isSuperAdmin && ( <td style={{ padding: '12px', textAlign: 'right' }}>
                    {editingId === user.id ? (
                      <>
                        <input type="password" placeholder="新密码，留空不改" value={editData.password} onChange={(e) => setEditData({ ...editData, password: e.target.value })} style={{ maxWidth: 180, marginRight: 8 }} />
                        <button onClick={() => saveEdit(user.id)}>保存</button>
                        <button onClick={() => setEditingId(null)} style={{ marginLeft: 8 }}>取消</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(user)}>编辑</button>
                        <button onClick={() => deleteUser(user.id)} style={{ marginLeft: 8 }}>删除</button>
                      </>
                    )}
                  </td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </AdminLayout>
  );
};
