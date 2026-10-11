import { useSiteEditor } from './editor-context'
import ThemeToggle from './ThemeToggle'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AccountSecurity, { SignInPanel, useSessionBootstrap } from './AccountSecurity'
import { api, logout } from './api'

const permissions = { viewOnly: 'View users and logs', editUsers: 'Edit user profiles', manageContent: 'Manage content', advisorDashboard: 'Open Adviser dashboard and view applications', advisorMessages: 'View and mark support messages', advisorStatusUpdates: 'Change application status', advisorDocuments: 'Request and review documents', advisorDeleteApplications: 'Delete applications' }
const blankStaff = { firstName: '', lastName: '', email: '', password: '', role: 'advisor' }

export default function AdminDashboard() {
  const preview = useSiteEditor()?.enabled
  const { accessToken: token, user: me, ready } = useSessionBootstrap()
  const [users, setUsers] = useState([])
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState('students')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, hasMore: false })
  const [createOpen, setCreateOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [staffForm, setStaffForm] = useState(blankStaff)
  const [busy, setBusy] = useState(false)
  const isAdmin = me?.role === 'admin'
  const can = key => preview || isAdmin || me?.permissions?.[key] === true
  const allowed = ['admin', 'moderator'].includes(me?.role)
  const load = async () => {
    if (preview || !token || !allowed || !can('viewOnly')) return
    const result = await api(view === 'activity' ? `/api/admin/logs?page=${page}&limit=25` : `/api/admin/users?page=${page}&limit=25&roleGroup=${view === 'staff' ? 'staff' : 'students'}`)
    if (view === 'activity') setLogs(result.logs || [])
    else setUsers(result.users || [])
    setMeta(result)
  }
  useEffect(() => {
    if (preview) { setUsers([]); setLogs([]); setBusy(false); return }
    let active = true
    if (!token) { setUsers([]); setLogs([]); setStaffForm(blankStaff); setCreateOpen(false); setSecurityOpen(false); return }
    if (!allowed || !can('viewOnly')) return
    setBusy(true); setError(''); setUsers([]); setLogs([])
    api(view === 'activity' ? `/api/admin/logs?page=${page}&limit=25` : `/api/admin/users?page=${page}&limit=25&roleGroup=${view === 'staff' ? 'staff' : 'students'}`).then(result => {
      if (!active) return
      if (view === 'activity') setLogs(result.logs || [])
      else setUsers(result.users || [])
      setMeta(result)
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [token, view, page, allowed, preview])
  const signOut = async () => {
    if (preview) return
    if (busy) return
    setBusy(true); setError('')
    try { await logout(); setUsers([]); setLogs([]); setStaffForm(blankStaff); setCreateOpen(false); setSecurityOpen(false) } catch (err) { setError(`Sign out could not finish: ${err.message} Please try again.`) } finally { setBusy(false) }
  }
  const mutate = async (url, options, success) => {
    if (preview) return
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await api(url, options); setNotice(success); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const createStaff = async event => {
    event.preventDefault(); if (preview || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/admin/staff', { method: 'POST', body: staffForm })
      setStaffForm(blankStaff); setCreateOpen(false); setNotice('Staff account created. The new staff member must verify their email and enroll an authenticator before accessing the workspace.')
      if (view !== 'staff' || page !== 1) { setView('staff'); setPage(1) } else await load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const setRole = (user, role) => {
    if (role === user.role || !window.confirm(`Change this account from ${user.role} to ${role}? Existing access will be reviewed by the server.`)) return
    mutate(`/api/admin/users/${user.id}/role`, { method: 'PATCH', body: { role, permissions: role === 'moderator' ? { viewOnly: true } : {} } }, 'Account role updated.')
  }
  const setPermission = (user, key) => mutate(`/api/admin/moderators/${user.id}/permissions`, { method: 'PATCH', body: { permissions: { ...user.permissions, [key]: !user.permissions?.[key] } } }, 'Permissions updated.')
  const switchView = next => { setPage(1); setView(next); setError(''); setNotice('') }
  if (!ready) return <main className="auth-card" role="status">Loading your session…</main>
  if (!token) return <div className="portal-page adviser-login"><div className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><Link to="/">Back to website</Link></div><SignInPanel workspace="admin" onSuccess={() => setError('')} /></div>
  const table = <div className="admin-table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Created</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed user'}</strong><small>{user.email}</small></td><td>{isAdmin && user.role !== 'admin' ? <select aria-label={`Role for ${user.email}`} disabled={busy} value={user.role} onChange={event => setRole(user, event.target.value)}><option value="student">Student</option><option value="advisor">Adviser</option><option value="moderator">Moderator</option></select> : user.role}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td></tr>)}{!users.length && <tr><td colSpan={3}>{busy ? 'Loading…' : 'No accounts on this page.'}</td></tr>}</tbody></table></div>
  return <div className="portal-page admin-page"><header className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><div className="portal-nav"><span>{isAdmin ? 'Admin dashboard' : 'Moderator dashboard'}</span><button data-preview-navigation onClick={() => setSecurityOpen(!securityOpen)}>Account security</button><button disabled={busy} onClick={signOut}>Sign out</button></div></header><main className="admin-main">{error && <p className="form-error adviser-error" role="alert">{error}</p>}{notice && <p className="application-notice" role="status">{notice}</p>}{securityOpen ? <AccountSecurity preview={preview} onClose={() => setSecurityOpen(false)} /> : !allowed || !can('viewOnly') ? <section className="admin-panel"><h2>Access not granted</h2><p>An administrator must grant access to this workspace.</p></section> : <><div className="adviser-heading"><div><p className="eyebrow">Access control</p><h1>People &<br /><em>permissions.</em></h1></div><div className="adviser-heading-actions">{can('manageContent') && <button className="button button-dark" onClick={() => window.location.assign('/?edit=1')}>Open website Edit Mode</button>}<button disabled={busy} onClick={() => { setBusy(true); load().catch(err => setError(err.message)).finally(() => setBusy(false)) }}>Refresh</button></div></div><div className="admin-workspace"><aside className="admin-sidebar"><button data-preview-navigation className={view === 'students' ? 'active' : ''} onClick={() => switchView('students')}>Students</button><button data-preview-navigation className={view === 'staff' ? 'active' : ''} onClick={() => switchView('staff')}>Advisers & Moderators</button><button data-preview-navigation className={view === 'activity' ? 'active' : ''} onClick={() => switchView('activity')}>Activity history</button></aside><div className="admin-view">{view === 'students' && <section className="admin-panel"><h2>Students</h2><p>Only an administrator can grant staff roles.</p>{table}</section>}{view === 'staff' && <><section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">Staff access</p><h2>Advisers & Moderators</h2></div>{isAdmin && <button data-preview-navigation className="button button-dark" onClick={() => setCreateOpen(!createOpen)}>{createOpen ? 'Close' : 'Add staff account'}</button>}</div>{createOpen && <form className="staff-create-form" onSubmit={createStaff}><label>First name<input required maxLength={100} autoComplete="off" value={staffForm.firstName} onChange={event => setStaffForm({ ...staffForm, firstName: event.target.value })} /></label><label>Last name<input required maxLength={100} autoComplete="off" value={staffForm.lastName} onChange={event => setStaffForm({ ...staffForm, lastName: event.target.value })} /></label><label>Email address<input required type="email" maxLength={254} autoComplete="off" value={staffForm.email} onChange={event => setStaffForm({ ...staffForm, email: event.target.value })} /></label><label>Initial password<input required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={staffForm.password} onChange={event => setStaffForm({ ...staffForm, password: event.target.value })} /></label><label>Account type<select value={staffForm.role} onChange={event => setStaffForm({ ...staffForm, role: event.target.value })}><option value="advisor">Adviser</option><option value="moderator">Moderator</option></select></label><button disabled={busy} className="button button-dark">{busy ? 'Creating…' : 'Create account'}</button><p>Use at least 15 characters and share the password through a private channel. The staff member can reset it through Forgot password.</p></form>}{table}</section>{isAdmin && <section className="admin-panel"><h2>Moderator access rights</h2><p>Permissions for moderators shown on this page.</p>{users.filter(user => user.role === 'moderator').map(user => <article className="moderator-card" key={user.id}><strong>{user.email}</strong><div className="permission-grid">{Object.entries(permissions).map(([key, label]) => <label key={key}><input disabled={busy} type="checkbox" checked={Boolean(user.permissions?.[key])} onChange={() => setPermission(user, key)} />{label}</label>)}</div></article>)}</section>}</>}{view === 'activity' && <section className="admin-panel"><h2>Activity history</h2><p>Security history is retained for review.</p><div className="admin-table-wrap"><table><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Description</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.email}</td><td><code>{log.actionType}</code></td><td>{log.description}</td></tr>)}{!logs.length && <tr><td colSpan={4}>{busy ? 'Loading…' : 'No activity on this page.'}</td></tr>}</tbody></table></div></section>}<div className="pagination"><button disabled={busy || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {meta.total} records</span><button disabled={busy || !meta.hasMore} onClick={() => setPage(page + 1)}>Next</button></div></div></div></>}</main></div>
}
