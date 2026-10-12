import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { acceptSession, api, getSession, logout, refreshSession, subscribeSession } from './api'
import './security.css'

export function useSession() { return useSyncExternalStore(subscribeSession, getSession, getSession) }
export function useSessionBootstrap() {
  const session = useSession()
  useEffect(() => { if (!getSession().ready) refreshSession().catch(() => {}) }, [])
  return session
}
export function RecoveryCodes({ codes, onDone }) {
  return <section className="recovery-codes" aria-label="Recovery codes"><h2>Save your recovery codes</h2><p>Each code works once if you lose your authenticator. Save these somewhere private before continuing. They will not be shown again.</p><pre>{codes.join('\n')}</pre><button type="button" className="button button-dark" onClick={onDone}>I have saved my recovery codes</button></section>
}

export function SignInPanel({ workspace = 'student', onSuccess, onBack, initialPending = null }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', code: '' })
  const [pending, setPending] = useState(initialPending)
  const [setup, setSetup] = useState(null)
  const [recoveryCodes, setRecoveryCodes] = useState([])
  const [authenticatedResult, setAuthenticatedResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const complete = async (result) => {
    const role = result.user?.role
    const allowed = workspace === 'student' || (workspace === 'admin' ? ['admin', 'moderator'].includes(role) : role === 'admin' || role === 'advisor' || (role === 'moderator' && (result.user?.permissions?.adminPermissions || result.user?.permissions?.advisorDashboard)))
    acceptSession(result)
    setForm({ email: '', password: '', firstName: '', lastName: '', code: '' })
    setPending(null); setSetup(null)
    if (!allowed) { await logout(); throw new Error('This account does not have access to this workspace.') }
    if (workspace === 'student' && role !== 'student') { window.location.assign(role === 'advisor' ? '/advisor' : '/admin'); return }
    onSuccess?.(result)
  }
  const handleResult = async (result) => {
    if (result.requiresEmailVerification || result.requiresTwoFactor || result.requiresMfaEnrollment) {
      setPending(result); setSetup(null); update('password', ''); update('code', '')
      return
    }
    if (result.recoveryCodes?.length) { setRecoveryCodes(result.recoveryCodes); setAuthenticatedResult(result); return }
    await complete(result)
  }
  useEffect(() => {
    if (initialPending) setPending(initialPending)
    else if (new URLSearchParams(window.location.search).get('auth') === 'pending') {
      setBusy(true)
      api('/api/auth/pending', { auth: false }).then(handleResult).catch(err => setError(err.message)).finally(() => setBusy(false))
    } else {
      const result = new URLSearchParams(window.location.search).get('auth')
      if (result === 'account_exists') setError('Use your existing email and password to sign in, or choose Forgot your password. Google sign-in has not been linked to this account.')
      else if (result === 'verify_email') setPending({ requiresEmailVerification: true })
      else if (result === 'failed') setError('Google sign-in could not be completed. Please try again or use email and password.')
    }
    const url = new URL(window.location.href); if (url.searchParams.get('edit') !== '1') { url.searchParams.delete('auth'); window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash) }
  }, [])
  const submit = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('')
    try {
      if (pending?.requiresMfaEnrollment) {
        if (!setup) setSetup(await api('/api/2fa/setup', { method: 'POST', auth: false, body: { enrollmentToken: pending.enrollmentToken } }))
        else await handleResult(await api('/api/2fa/enable', { method: 'POST', auth: false, body: { setupToken: setup.setupToken, enrollmentToken: pending.enrollmentToken, code: form.code } }))
      } else if (pending?.requiresTwoFactor) {
        await handleResult(await api('/api/auth/2fa/verify', { method: 'POST', auth: false, body: { challengeToken: pending.challengeToken, code: form.code } }))
      } else {
        await handleResult(await api(`/api/auth/${mode}`, { method: 'POST', auth: false, body: { email: form.email, password: form.password, ...(mode === 'register' ? { firstName: form.firstName, lastName: form.lastName } : {}) } }))
      }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const resend = async () => {
    setBusy(true); setError('')
    try { const result = await api('/api/auth/resend-verification', { method: 'POST', auth: false, body: { email: pending?.email || form.email } }); setNotice(result.message || 'If verification is needed, a new email has been sent.') } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const restart = () => { setPending(null); setSetup(null); setError(''); setNotice(''); update('password', ''); update('code', '') }
  if (recoveryCodes.length) return <main className="auth-card"><RecoveryCodes codes={recoveryCodes} onDone={async () => { setBusy(true); try { await complete(authenticatedResult); setRecoveryCodes([]); setAuthenticatedResult(null) } catch (err) { setError(err.message) } finally { setBusy(false) } }} />{error && <p role="alert" className="form-error">{error}</p>}</main>
  return <main className="auth-card"><p className="eyebrow">{workspace === 'student' ? 'Student account' : `${workspace === 'admin' ? 'Admin' : 'Adviser'} workspace`}</p><h1>{pending?.requiresEmailVerification ? 'Check your email' : pending?.requiresMfaEnrollment ? 'Protect your account' : pending?.requiresTwoFactor ? 'Two-step verification' : mode === 'register' ? 'Create your account' : 'Welcome back.'}</h1>{pending?.requiresEmailVerification ? <><p>Verify your email address before signing in. Open the link in the email, then return here to sign in.</p>{!pending.email && <label className="portal-field">Email address<input type="email" autoComplete="email" value={form.email} onChange={event => update('email', event.target.value)} /></label>}<button disabled={busy} className="button button-dark full" onClick={resend}>{busy ? 'Sending…' : 'Resend verification email'}</button><button className="auth-secondary" disabled={busy} onClick={restart}>Return to sign in</button></> : <form data-analytics-label={mode === 'register' ? 'account_registration' : 'sign_in'} onSubmit={submit}><fieldset disabled={busy} className="security-fieldset">{pending?.requiresMfaEnrollment ? <><p>Staff accounts require an authenticator and recovery codes before access is granted.</p>{setup && <><img className="mfa-qr" src={setup.qrCodeDataUrl} alt="Scan this code with your authenticator app" /><label className="portal-field">Manual setup key<code className="manual-key">{setup.manualKey}</code></label></>}</> : null}{pending?.requiresTwoFactor || setup ? <label className="portal-field">{setup ? 'Code from your authenticator' : 'Authenticator or recovery code'}<input required maxLength={64} inputMode={setup ? 'numeric' : 'text'} autoComplete="one-time-code" value={form.code} onChange={e => update('code', e.target.value)} /></label> : !pending?.requiresMfaEnrollment && <>{mode === 'register' && <><label className="portal-field">First name<input required autoComplete="given-name" maxLength={100} value={form.firstName} onChange={e => update('firstName', e.target.value)} /></label><label className="portal-field">Last name<input required autoComplete="family-name" maxLength={100} value={form.lastName} onChange={e => update('lastName', e.target.value)} /></label></>}<label className="portal-field">Email address<input required type="email" autoComplete="username" maxLength={254} value={form.email} onChange={e => update('email', e.target.value)} /></label><label className="portal-field">Password<input required type="password" minLength={mode === 'register' ? 15 : undefined} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={e => update('password', e.target.value)} /></label>{mode === 'register' && <p>Use at least 15 characters. Read our <Link to="/privacy">privacy notice</Link> before creating an account.</p>}</>}<button data-analytics-label={mode === 'register' ? 'account_registration' : 'sign_in'} className="button button-dark full" type="submit">{busy ? 'Please wait…' : pending?.requiresMfaEnrollment ? setup ? 'Verify and continue' : 'Set up authenticator' : pending?.requiresTwoFactor ? 'Verify and continue' : mode === 'register' ? 'Create account' : 'Sign in'}</button></fieldset></form>}{error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!pending && <><Link className="forgot-password-link" to="/forgot-password">Forgot your password?</Link><a className="google-button" href="/api/auth/google/start">Continue with Google</a>{workspace === 'student' && <button className="auth-secondary" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); restart() }}>{mode === 'login' ? 'Create a student account' : 'Sign in instead'}</button>}</>}{pending && !pending.requiresEmailVerification && <button className="auth-secondary" disabled={busy} onClick={restart}>Start again</button>}{onBack && <button className="auth-secondary" disabled={busy} onClick={onBack}>Back to website</button>}</main>
}

export default function AccountSecurity({ onClose, preview = false }) {
  const { user } = useSession()
  const [settings, setSettings] = useState(preview ? { emailVerified: true, twoFactorEnabled: false, hasPassword: true } : null)
  const [setup, setSetup] = useState(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState([])
  const load = () => api('/api/auth/security').then(setSettings)
  useEffect(() => { if (!preview) load().catch(err => setError(err.message)) }, [preview])
  const change = async action => {
    if (preview) return
    if (busy) return
    if (action === 'disable' && !window.confirm('Turn off two-step verification? Your account will be protected only by its sign-in method.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api(`/api/2fa/${action}`, { method: 'POST', body: { password, code, ...(setup ? { setupToken: setup.setupToken } : {}) } })
      if (result.accessToken && result.user) acceptSession(result)
      if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes)
      if (action === 'setup') { setSetup(result); setCode(''); setPassword('') }
      else { setSetup(null); setPassword(''); setCode(''); setNotice(action === 'disable' ? 'Two-step verification disabled.' : 'Account security updated.'); await load() }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <section className="account-security"><div className="security-heading"><h2>Account security</h2><button data-preview-navigation disabled={busy} onClick={onClose}>Back to workspace</button></div>{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}{!settings ? <p>Loading security settings… {error && <button onClick={() => load().catch(err => setError(err.message))}>Try again</button>}</p> : recoveryCodes.length ? <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes([])} /> : <><p>Email: {settings.emailVerified ? 'verified' : 'verification required'}</p><p>Two-step verification: <strong>{settings.twoFactorEnabled ? 'enabled' : 'not enabled'}</strong></p>{settings.twoFactorEnabled && <p>{settings.recoveryCodesRemaining} recovery codes remaining.</p>}<form onSubmit={event => { event.preventDefault(); change(setup ? 'enable' : 'setup') }}><fieldset disabled={busy} className="security-fieldset">{!setup && settings.hasPassword && <label className="portal-field">Current password<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>}{setup && <><img className="mfa-qr" src={setup.qrCodeDataUrl} alt="Scan with your authenticator app" /><p className="manual-key">{setup.manualKey}</p></>}{(settings.twoFactorEnabled || setup) && <label className="portal-field">{setup ? 'Code from your new authenticator' : 'Current authenticator or recovery code'}<input required autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label>}{!settings.hasPassword && settings.requiresRecentLogin && <p><a href="/api/auth/google/start">Sign in with Google again</a> before changing these settings.</p>}<div className="security-actions"><button className="button button-dark" type="submit">{busy ? 'Please wait…' : setup ? 'Enable two-step verification' : settings.twoFactorEnabled ? 'Replace authenticator' : 'Set up two-step verification'}</button>{settings.twoFactorEnabled && !setup && <><button type="button" onClick={() => change('recovery-codes')}>Generate new recovery codes</button>{user?.role === 'student' && <button type="button" onClick={() => change('disable')}>Disable two-step verification</button>}</>}</div></fieldset></form></>}</section>
}
