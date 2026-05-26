'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AdminLayout from '../components/AdminLayout';
import { api, parseErrorResponse } from '../services/api';
import { useIsMobile } from '../hooks/useMediaQuery';

type AdminRole = 'super_admin' | 'admin' | 'support';
type AdminUser = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  role: AdminRole;
};

const roleKeys: AdminRole[] = ['super_admin', 'admin', 'support'];
const agentRoleKeys: AdminRole[] = ['admin', 'support'];

export const AdminUsers = () => {
  const { t } = useTranslation();
  const { agentId } = useParams<{ agentId?: string }>();
  const isMobile = useIsMobile();
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
  const availableRoleKeys = agentId ? agentRoleKeys : roleKeys;
  const authHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

    const loadUsers = async () => {
      if (agentId) {
        const data = await api.listAgentMembers(agentId);
        setUsers(data.members.map(member => ({
          id: member.id,
          email: member.email,
          name: member.name,
          is_active: member.is_active,
          role: member.member_role as AdminRole,
        })));
        return;
      }

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

useEffect(() => {
  if (!agentId) return;
  if (role === 'super_admin') {
    setRole('admin');
  }
  if (editData.role === 'super_admin') {
    setEditData(prev => ({ ...prev, role: 'admin' }));
  }
}, [agentId, editData.role, role]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    if (agentId) {
      const data = await api.createAgentMember(agentId, { email, name, password, role: role === 'super_admin' ? 'admin' : role });
      setMessage(t('users.userCreated', { email: data.email }));
      setEmail('');
      setName('');
      setPassword('');
      setRole('admin');
      await loadUsers();
      return;
    }

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

    if (agentId) {
      await api.createAgentMember(agentId, {
        email: editData.email,
        name: editData.name,
        password: editData.password.trim() || undefined,
        role: editData.role === 'super_admin' ? 'admin' : editData.role,
      });
      setEditingId(null);
      setMessage(t('users.userUpdated'));
      await loadUsers();
      return;
    }

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

    if (agentId) {
      const res = await api.deleteAgentMember(agentId, id);
      if (!res.success) {
        setError(t('users.deleteFailed'));
        return;
      }
      setMessage(t('users.userDeleted'));
      await loadUsers();
      return;
    }

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
    <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto', padding: isMobile ? 'var(--space-4)' : '0' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          {t('users.title')}
        </h1>
      </div>

      {message && <div style={{ color: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>{message}</div>}
      {error && <div style={{ color: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>{error}</div>}
      {isSuperAdmin && (<div className="liquid-glass-card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-5)' }}>{t('users.addAdmin')}</h2>
        <form onSubmit={createUser} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr 180px auto', gap: 'var(--space-4)', alignItems: isMobile ? 'stretch' : 'end' }}>
          <label>{t('users.email')}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>{t('users.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>{t('users.password')}<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label>{t('users.role')}<select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>{availableRoleKeys.map((r) => (<option key={r} value={r}>{t(`users.roleLabels.${r}`)}</option>
    ))}
  </select>
</label>
          <button type="submit" style={{ minHeight: isMobile ? '44px' : undefined, width: isMobile ? '100%' : undefined }}>{t('users.create')}</button>
        </form>
      </div>
	)}
      <div className="liquid-glass-card" style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-5)' }}>{t('users.adminList')}</h2>

        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {users.map((user) => (
              <div key={user.id} className="liquid-glass-card" style={{ padding: 'var(--space-4)' }}>
                {editingId === user.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>#{user.id}</span>
                      <span className={user.is_active ? 'badge badge-success' : 'badge badge-error'}>
                        {user.is_active ? t('users.statusEnabled') : t('users.statusDisabled')}
                      </span>
                    </div>
                    <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t('users.email')}
                      <input value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} style={{ width: '100%', marginTop: 'var(--space-1)' }} />
                    </label>
                    <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t('users.name')}
                      <input value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} style={{ width: '100%', marginTop: 'var(--space-1)' }} />
                    </label>
                    <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t('users.role')}
                      <select value={editData.role} onChange={(e) => setEditData({ ...editData, role: e.target.value as AdminRole })} style={{ width: '100%', marginTop: 'var(--space-1)' }}>
                        {availableRoleKeys.map((r) => (<option key={r} value={r}>{t(`users.roleLabels.${r}`)}</option>))}
                      </select>
                    </label>
                    <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <input type="checkbox" checked={editData.is_active} onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })} />
                      {t('users.statusEnabled')}
                    </label>
                    <input type="password" placeholder={t('users.newPasswordPlaceholder')} value={editData.password} onChange={(e) => setEditData({ ...editData, password: e.target.value })} style={{ width: '100%' }} />
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button onClick={() => saveEdit(user.id)} style={{ flex: 1 }}>{t('users.save')}</button>
                      <button onClick={() => setEditingId(null)} className="btn-ghost" style={{ flex: 1 }}>{t('users.cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>#{user.id}</span>
                      <span className={user.is_active ? 'badge badge-success' : 'badge badge-error'}>
                        {user.is_active ? t('users.statusEnabled') : t('users.statusDisabled')}
                      </span>
                    </div>
                    <div style={{ marginBottom: 'var(--space-2)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{user.name}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{user.email}</div>
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                      {t(`users.roleLabels.${user.role}`)}
                    </div>
                    {isSuperAdmin && (
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button onClick={() => startEdit(user)} className="btn-ghost" style={{ flex: 1, minHeight: '44px' }}>{t('users.edit')}</button>
                        <button onClick={() => deleteUser(user.id)} className="btn-ghost" style={{ flex: 1, minHeight: '44px', color: 'var(--color-error)' }}>{t('users.delete')}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
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
                    <td style={{ padding: '12px' }}>{editingId === user.id ? (
                      <select value={editData.role} onChange={(e) => setEditData({ ...editData, role: e.target.value as AdminRole })}>
                        {availableRoleKeys.map((r) => (<option key={r} value={r}>{t(`users.roleLabels.${r}`)}</option>))}
                      </select>
                    ) : t(`users.roleLabels.${user.role}`)}</td>
                    <td style={{ padding: '12px' }}>{editingId === user.id ? <label><input type="checkbox" checked={editData.is_active} onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })} /> {t('users.statusEnabled')}</label> : user.is_active ? t('users.statusEnabled') : t('users.statusDisabled')}</td>
                    {isSuperAdmin && (
                      <td style={{ padding: '12px', textAlign: 'right' }}>
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </AdminLayout>
  );
};
