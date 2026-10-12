import { useSiteEditor } from './editor-context'
import ThemeToggle from './ThemeToggle'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AccountSecurity, { SignInPanel, useSessionBootstrap } from './AccountSecurity'
import { api, logout } from './api'
import { universities, universitySlug } from './universities'

const permissions = { adminPermissions: 'Admin permissions', viewOnly: 'View users and logs', manageContent: 'Manage content', advisorDashboard: 'Open Adviser dashboard and view applications', advisorMessages: 'View and mark support messages', advisorStatusUpdates: 'Change application status', advisorDocuments: 'Request and review documents', advisorDeleteApplications: 'Delete applications' }
const blankStaff = { firstName: '', lastName: '', email: '', password: '', role: 'advisor' }
const durationLabel = seconds => { const value = Math.max(0, Number(seconds) || 0); return value < 60 ? `${value}s` : `${Math.floor(value / 60)}m ${value % 60}s` }
const metricLabel = value => String(value || '').replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
const pageLabel = path => {
  const raw = String(path || '/')
  const locale = raw.match(/^\/(en|ro)(?=\/|$)/)?.[1]
  const value = raw.replace(/^\/(en|ro)(?=\/|$)/, '') || '/'
  const localize = label => locale ? `${label} · ${locale === 'ro' ? 'Romanian' : 'English'}` : label
  if (value === '/' || value === '') return localize('Home page')
  const known = { '/blog': 'Blog page', '/free-student-advisory': 'Free student advisory page', '/study-in-uk': 'Study in the UK page', '/university-admission': 'University admission page', '/privacy': 'Privacy notice page', '/terms': 'Terms and conditions page' }
  if (known[value]) return localize(known[value])
  if (value.startsWith('/blog/')) return localize(`Blog article · ${metricLabel(value.slice(6).replaceAll('-', ' '))}`)
  return localize(`${metricLabel(value.split('/').filter(Boolean).join(' / ').replaceAll('-', ' '))} page`)
}
const sectionLabel = section => ({ hero: 'Hero section', introduction: 'Introduction section', explore: 'Find your next step section', pathway: 'How it works section', universities: 'University directory section', stories: 'Student stories section', faq: 'Frequently asked questions section', documents: 'Documents section', 'site-navigation': 'Header navigation', footer: 'Page footer', 'page-body': 'Page body' }[section] || `${metricLabel(section || 'page body')} section`)
const universityName = slug => universities.find(item => universitySlug(item.name) === slug)?.name || String(slug || '').replaceAll('-', ' ')
const actionLabel = value => metricLabel(value)

export default function AdminDashboard() {
  const preview = useSiteEditor()?.enabled
  const { accessToken: token, user: me, ready } = useSessionBootstrap()
  const [users, setUsers] = useState([])
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState('metrics')
  const [metrics, setMetrics] = useState(null)
  const [metricDays, setMetricDays] = useState(30)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, hasMore: false })
  const [createOpen, setCreateOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [emailEdit, setEmailEdit] = useState(null)
  const [staffForm, setStaffForm] = useState(blankStaff)
  const [busy, setBusy] = useState(false)
  const isAdmin = me?.role === 'admin'
  const hasAdminPermissions = preview || isAdmin || me?.permissions?.adminPermissions === true
  const can = key => hasAdminPermissions || me?.permissions?.[key] === true
  const allowed = ['admin', 'moderator'].includes(me?.role)
  const load = async () => {
    if (preview || !token || !allowed || !can('viewOnly')) return
    const result = await api(view === 'metrics' ? `/api/admin/metrics?days=${metricDays}` : view === 'activity' ? `/api/admin/logs?page=${page}&limit=25` : `/api/admin/users?page=${page}&limit=25&roleGroup=${view === 'staff' ? 'staff' : 'students'}`)
    if (view === 'activity') setLogs(result.logs || [])
    else if (view === 'metrics') setMetrics(result)
    else setUsers(result.users || [])
    if (view !== 'metrics') setMeta(result)
  }
  useEffect(() => {
    if (preview) { setUsers([]); setLogs([]); setBusy(false); return }
    let active = true
    if (!token) { setUsers([]); setLogs([]); setStaffForm(blankStaff); setCreateOpen(false); setSecurityOpen(false); return }
    if (!allowed || !can('viewOnly')) return
    if (view === 'metrics' && !hasAdminPermissions) { setView('students'); return }
    setBusy(true); setError(''); setUsers([]); setLogs([])
    api(view === 'metrics' ? `/api/admin/metrics?days=${metricDays}` : view === 'activity' ? `/api/admin/logs?page=${page}&limit=25` : `/api/admin/users?page=${page}&limit=25&roleGroup=${view === 'staff' ? 'staff' : 'students'}`).then(result => {
      if (!active) return
      if (view === 'activity') setLogs(result.logs || [])
      else if (view === 'metrics') setMetrics(result)
      else setUsers(result.users || [])
      if (view !== 'metrics') setMeta(result)
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [token, view, page, allowed, preview, metricDays, hasAdminPermissions])
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
  const saveStaffEmail = async (event, user) => {
    event.preventDefault(); if (preview || busy || !emailEdit) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api(`/api/admin/users/${user.id}/email`, { method: 'PATCH', body: { email: emailEdit.email, ...(user.role === 'admin' ? { code: emailEdit.code } : {}) } })
      setNotice(result.message || 'Verification email sent.'); setEmailEdit(null); await load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const setStaffBlocked = user => mutate(`/api/admin/staff/${user.id}/block`, { method: 'PATCH', body: { blocked: !user.blocked } }, user.blocked ? 'Staff account access restored.' : 'Staff account temporarily blocked.')
  const deleteStaff = user => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    if (!window.confirm(`Permanently delete ${name} (${user.role})? This cannot be undone.`)) return
    mutate(`/api/admin/staff/${user.id}`, { method: 'DELETE' }, 'Staff account deleted.')
  }
  const switchView = next => { setPage(1); setView(next); setError(''); setNotice('') }
  if (!ready) return <main className="auth-card" role="status">Loading your session…</main>
  if (!token) return <div className="portal-page adviser-login"><div className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><Link to="/">Back to website</Link></div><SignInPanel workspace="admin" onSuccess={() => setError('')} /></div>
  const table = <div className="admin-table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Created</th>{view === 'staff' && hasAdminPermissions && <th>Actions</th>}</tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed user'}</strong><small>{user.email}</small>{user.pendingEmail && <small>Pending: {user.pendingEmail}</small>}</td><td>{hasAdminPermissions && user.role !== 'admin' ? <><select aria-label={`Role for ${user.email}`} disabled={busy} value={user.role} onChange={event => setRole(user, event.target.value)}><option value="student">Student</option><option value="advisor">Adviser</option><option value="moderator">Moderator</option></select>{user.blocked && <small className="staff-blocked-label">Temporarily blocked</small>}</> : user.role}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td>{view === 'staff' && hasAdminPermissions && <td>{(user.role !== 'admin' || (isAdmin && user.id === me?.id)) && <div className="staff-row-actions"><button disabled={busy} onClick={() => setEmailEdit({ id: user.id, email: user.email, code: '' })}>Edit email</button>{['advisor', 'moderator'].includes(user.role) && <><button disabled={busy} onClick={() => setStaffBlocked(user)}>{user.blocked ? 'Unblock' : 'Block temporarily'}</button><button className="staff-delete-action" disabled={busy} onClick={() => deleteStaff(user)}>Delete</button></>}</div>}{emailEdit?.id === user.id && <form className="staff-email-form" onSubmit={event => saveStaffEmail(event, user)}><label>New email<input type="email" required maxLength={255} autoComplete="off" value={emailEdit.email} onChange={event => setEmailEdit({ ...emailEdit, email: event.target.value })} /></label>{user.role === 'admin' && <label>Authenticator or recovery code<input required autoComplete="one-time-code" value={emailEdit.code} onChange={event => setEmailEdit({ ...emailEdit, code: event.target.value })} /><small>Required to change the main administrator email.</small></label>}<div className="staff-row-actions"><button className="button button-dark" disabled={busy}>{busy ? 'Sending…' : 'Send verification'}</button><button type="button" disabled={busy} onClick={() => setEmailEdit(null)}>Cancel</button></div></form>}</td>}</tr>)}{!users.length && <tr><td colSpan={view === 'staff' && hasAdminPermissions ? 4 : 3}>{busy ? 'Loading…' : 'No accounts on this page.'}</td></tr>}</tbody></table></div>
  const metricOverview = metrics?.overview
  const maxDailyViews = Math.max(1, ...(metrics?.daily || []).map(day => Number(day.pageViews) || 0))
  const metricTitleCase = value => metricLabel(value).replace(/\b[a-z]/g, letter => letter.toUpperCase())
  const metricTable = (headers, rows, empty) => <div className="metrics-table-scroll"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows : <tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>
  const metricsView = <section className="admin-panel metrics-panel"><div className="admin-panel-heading"><div><p className="eyebrow">Website analytics</p><h2>What visitors use</h2><p>Consent-based analytics. Admin and adviser dashboard traffic is excluded.</p></div><label className="metrics-range">Period<select value={metricDays} onChange={event => setMetricDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label></div>{metricOverview ? <><div className="metrics-cards"><article><span>Unique browsers</span><strong>{metricOverview.visitors.toLocaleString()}</strong></article><article><span>Visits</span><strong>{metricOverview.sessions.toLocaleString()}</strong></article><article><span>Page views</span><strong>{metricOverview.pageViews.toLocaleString()}</strong></article><article><span>Average time per visit</span><strong>{durationLabel(metricOverview.averageSessionSeconds)}</strong></article><article><span>Time spent on pages</span><strong>{durationLabel(metricOverview.totalSeconds)}</strong></article><article><span>Button and link clicks</span><strong>{metricOverview.actionClicks.toLocaleString()}</strong></article><article><span>Course searches</span><strong>{Number(metricOverview.courseSearches || 0).toLocaleString()}</strong></article></div><div className="metrics-grid"><section className="metrics-card"><h3>Page activity</h3><div className="metrics-bars">{metrics.daily.map(day => <div className="metrics-bar-column" key={String(day.day)} title={`${day.pageViews} page views`}><span style={{ height: `${Math.max(3, (Number(day.pageViews) / maxDailyViews) * 100)}%` }} /><small>{new Date(day.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></div>)}</div></section><section className="metrics-card"><h3>Actions: clicked vs completed</h3>{metricTable(['Button or link', 'Page', 'Section', 'Clicks', 'Attempts', 'Completed', 'Failed'], metrics.actions.map(action => <tr key={`${action.action}:${action.page}:${action.section}`}><td>{actionLabel(action.action)}</td><td>{pageLabel(action.page)}</td><td>{sectionLabel(action.section)}</td><td>{Number(action.clicks || 0)}</td><td>{Number(action.attempts || 0)}</td><td>{Number(action.successes || 0)}</td><td>{Number(action.failures || 0)}</td></tr>), 'No button or link activity recorded yet.')}</section><section className="metrics-card"><h3>Most clicked universities</h3>{metricTable(['University', 'Clicks', 'Visitors'], metrics.universities.map(item => <tr key={item.university}><td>{universityName(item.university)}</td><td>{Number(item.clicks || 0)}</td><td>{Number(item.visitors || 0)}</td></tr>), 'No university clicks recorded yet.')}</section><section className="metrics-card"><h3>Find your next step search keywords</h3><p>Terms entered in the university and course finder.</p>{metricTable(['Search keyword', 'Searches', 'Visitors'], metrics.courseSearches.map(item => <tr key={item.term}><td>{metricTitleCase(item.term.replaceAll('-', ' '))}</td><td>{Number(item.searches || 0)}</td><td>{Number(item.visitors || 0)}</td></tr>), 'No finder keywords recorded yet.')}</section><section className="metrics-card"><h3>Most viewed pages</h3>{metricTable(['Page', 'Views', 'Visitors', 'Avg time'], metrics.topPages.map(item => <tr key={item.path}><td>{pageLabel(item.path)}</td><td>{Number(item.views || 0)}</td><td>{Number(item.visitors || 0)}</td><td>{durationLabel(item.averageSeconds)}</td></tr>), 'No page views recorded yet.')}</section><section className="metrics-card"><h3>Most read sections</h3>{metricTable(['Page', 'Section', 'Views', 'Avg visible time'], metrics.topSections.map(item => <tr key={`${item.page}:${item.section}`}><td>{pageLabel(item.page)}</td><td>{sectionLabel(item.section)}</td><td>{Number(item.views || 0)}</td><td>{durationLabel(item.averageSeconds)}</td></tr>), 'No section reading activity recorded yet.')}</section></div><p className="metrics-footnote">Rankings include every page and section in the selected period and are sorted from most to least viewed. Tables scroll vertically when needed. Button labels and page sections identify where each action happened.</p></> : <p role="status">{busy ? 'Loading analytics…' : 'No analytics data is available yet.'}</p>}</section>
  return <div className="portal-page admin-page"><header className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><div className="portal-nav"><span>{isAdmin ? 'Admin dashboard' : 'Moderator dashboard'}</span><button data-preview-navigation onClick={() => setSecurityOpen(!securityOpen)}>Account security</button><button disabled={busy} onClick={signOut}>Sign out</button></div></header><main className="admin-main">{error && <p className="form-error adviser-error" role="alert">{error}</p>}{notice && <p className="application-notice" role="status">{notice}</p>}{securityOpen ? <AccountSecurity preview={preview} onClose={() => setSecurityOpen(false)} /> : !allowed || !can('viewOnly') ? <section className="admin-panel"><h2>Access not granted</h2><p>An administrator must grant access to this workspace.</p></section> : <><div className="adviser-heading"><div><p className="eyebrow">{view === 'metrics' ? 'Website performance' : 'Access control'}</p><h1>{view === 'metrics' ? <>Visitor <em>metrics.</em></> : <>People &amp; <em>permissions.</em></>}</h1></div></div><div className="admin-workspace"><aside className="admin-sidebar">{hasAdminPermissions && <button data-preview-navigation className={view === 'metrics' ? 'active' : ''} onClick={() => switchView('metrics')}>Website metrics</button>}<button data-preview-navigation className={view === 'students' ? 'active' : ''} onClick={() => switchView('students')}>Students</button><button data-preview-navigation className={view === 'staff' ? 'active' : ''} onClick={() => switchView('staff')}>Advisers & Moderators</button><button data-preview-navigation className={view === 'activity' ? 'active' : ''} onClick={() => switchView('activity')}>Activity history</button>{can('manageContent') && <button className="admin-edit-mode" onClick={() => window.location.assign('/?edit=1')}>Open website Edit Mode</button>}</aside><div className="admin-view">{view === 'metrics' && hasAdminPermissions && metricsView}{view === 'students' && <section className="admin-panel"><h2>Students</h2><p>Only an administrator can grant staff roles.</p>{table}</section>}{view === 'staff' && <><section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">Staff access</p><h2>Advisers & Moderators</h2></div>{hasAdminPermissions && <button data-preview-navigation className="button button-dark" onClick={() => setCreateOpen(!createOpen)}>{createOpen ? 'Close' : 'Add staff account'}</button>}</div>{createOpen && <form className="staff-create-form" onSubmit={createStaff}><label>First name<input required maxLength={100} autoComplete="off" value={staffForm.firstName} onChange={event => setStaffForm({ ...staffForm, firstName: event.target.value })} /></label><label>Last name<input required maxLength={100} autoComplete="off" value={staffForm.lastName} onChange={event => setStaffForm({ ...staffForm, lastName: event.target.value })} /></label><label>Email address<input required type="email" maxLength={254} autoComplete="off" value={staffForm.email} onChange={event => setStaffForm({ ...staffForm, email: event.target.value })} /></label><label>Initial password<input required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={staffForm.password} onChange={event => setStaffForm({ ...staffForm, password: event.target.value })} /></label><label>Account type<select value={staffForm.role} onChange={event => setStaffForm({ ...staffForm, role: event.target.value })}><option value="advisor">Adviser</option><option value="moderator">Moderator</option></select></label><button disabled={busy} className="button button-dark">{busy ? 'Creating…' : 'Create account'}</button><p>Use at least 15 characters and share the password through a private channel. The staff member can reset it through Forgot password.</p></form>}{table}</section>{hasAdminPermissions && <section className="admin-panel"><h2>Moderator access rights</h2><p>Choose the access granted to each moderator. Admin permissions enables every capability shown here.</p>{users.filter(user => user.role === 'moderator').map(user => <article className="moderator-card" key={user.id}><strong>{user.email}</strong><div className="permission-grid">{Object.entries(permissions).map(([key, label]) => <label key={key}><input disabled={busy || (key !== 'adminPermissions' && user.permissions?.adminPermissions)} type="checkbox" checked={key === 'adminPermissions' ? Boolean(user.permissions?.adminPermissions) : Boolean(user.permissions?.adminPermissions || user.permissions?.[key])} onChange={() => setPermission(user, key)} />{label}</label>)}</div></article>)}</section>}</>}{view === 'activity' && <section className="admin-panel"><h2>Activity history</h2><p>Security history is retained for review.</p><div className="admin-table-wrap"><table><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Description</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.email}</td><td><code>{log.actionType}</code></td><td>{log.description}</td></tr>)}{!logs.length && <tr><td colSpan={4}>{busy ? 'Loading…' : 'No activity on this page.'}</td></tr>}</tbody></table></div></section>}{view !== 'metrics' && <div className="pagination"><button disabled={busy || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {meta.total} records</span><button disabled={busy || !meta.hasMore} onClick={() => setPage(page + 1)}>Next</button></div>}</div></div></>}</main></div>
}
