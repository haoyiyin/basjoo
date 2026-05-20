'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import AdminLayout from '../components/AdminLayout';
import { parseErrorResponse } from '../services/api';

type AdminRole = 'super_admin' | 'admin' | 'support';
type AdminUser = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  role: AdminRole;
};

const roleKeys: AdminRole[] = ['super_admin', 'admin', 'support'];

export const AdminUsers = () => {
  const { t } = useTranslation();
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
          role: admin.role as AdminRole,
        }]);
        return;
      }

      const res = await fetch('/api/admin/users', { headers: authHeaders });
      if (!res.ok) throw new Error(await parseErrorResponse(res) || t('users.loadUsersFailed'));
      const data = await res.json();
      setUsers(data);
    };

useEffect(() => {
  if (!token) return;
  loadUsers().catch((err) => setError(err.message));
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
      setError(data.detail || t('users.createFailed'));
      return;
    }

    setMessage(t('users.userCreated', { email: data.email }));
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
      setError(data.detail || t('users.saveFailed'));
      return;
    }

    setEditingId(null);
    setMessage(t('users.userUpdated'));
    await loadUsers();
  };

  const deleteUser = async (id: number) => {
    if (!window.confirm(t('users.confirmDelete'))) return;

    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || t('users.deleteFailed'));
      return;
    }

    setMessage(t('users.userDeleted'));
    await loadUsers();
  };

  return (
  <AdminLayout>
    <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          {t('users.title')}
        </h1>
      </div>

      {message && <div style={{ color: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>{message}</div>}
      {error && <div style={{ color: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>{error}</div>}
      {isSuperAdmin && (<div className="glass-card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-5)' }}>{t('users.addAdmin')}</h2>
        <form onSubmit={createUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 180px auto', gap: 'var(--space-4)', alignItems: 'end' }}>
          <label>{t('users.email')}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>{t('users.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>{t('users.password')}<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label>{t('users.role')}<select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>{roleKeys.map((r) => (<option key={r} value={r}>{t(`users.roleLabels.${r}`)}</option>
    ))}
  </select>
</label>
          <button type="submit">{t('users.create')}</button>
        </form>
      </div>
	)}
      <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-5)' }}>{t('users.adminList')}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '12px' }}>{t('users.id')}</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>{t('users.email')}</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>{t('users.name')}</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>{t('users.role')}</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>{t('users.status')}</th>
               {isSuperAdmin && <th style={{ textAlign: 'right', padding: '12px' }}>{t('users.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '12px' }}>{user.id}</td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? <input value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} /> : user.email}</td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? <input value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} /> : user.name}</td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? (<select value={editData.role} onChange={(e) => setEditData({ ...editData, role: e.target.value as AdminRole })}>
                      {roleKeys.map((r) => (
                        <option key={r} value={r}>
                          {t(`users.roleLabels.${r}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t(`users.roleLabels.${user.role}`)
                  )}
                </td>
                  <td style={{ padding: '12px' }}>{editingId === user.id ? <label><input type="checkbox" checked={editData.is_active} onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })} /> {t('users.statusEnabled')}</label> : user.is_active ? t('users.statusEnabled') : t('users.statusDisabled')}</td>
                 {isSuperAdmin && ( <td style={{ padding: '12px', textAlign: 'right' }}>
                    {editingId === user.id ? (
                      <>
                        <input type="password" placeholder={t('users.newPasswordPlaceholder')} value={editData.password} onChange={(e) => setEditData({ ...editData, password: e.target.value })} style={{ maxWidth: 180, marginRight: 8 }} />
                        <button onClick={() => saveEdit(user.id)}>{t('users.save')}</button>
                        <button onClick={() => setEditingId(null)} style={{ marginLeft: 8 }}>{t('users.cancel')}</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(user)}>{t('users.edit')}</button>
                        <button onClick={() => deleteUser(user.id)} style={{ marginLeft: 8 }}>{t('users.delete')}</button>
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
