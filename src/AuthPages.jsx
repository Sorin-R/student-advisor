import ThemeToggle from './ThemeToggle'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, clearClientSession } from './api'

function RecoveryShell({ children }) {
  return <div className="portal-page"><div className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><Link to="/">Back to website</Link></div><main className="auth-card">{children}</main></div>
}
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(''); setError('')
    try { const data = await api('/api/auth/forgot-password', { method: 'POST', auth: false, body: { email } }); setMessage(data.message || 'If the account exists, a reset link has been sent.') } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <RecoveryShell><p className="eyebrow">Account recovery</p><h1>Reset your<br /><em>password.</em></h1><p className="auth-copy">Enter your account email. The reset link is valid for 15 minutes and can be used once.</p><form onSubmit={submit}><label className="portal-field">Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>{message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="button button-dark full" type="submit">{busy ? 'Sending…' : 'Send reset link'}</button></form></RecoveryShell>
}
export function ResetPasswordPage() {
  const { token } = useParams()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async event => {
    event.preventDefault(); if (busy) return
    if (password !== confirmation) return setMessage('Passwords do not match.')
    setBusy(true); setMessage('')
    try { const data = await api(`/api/auth/reset-password/${encodeURIComponent(token)}`, { method: 'POST', auth: false, body: { password } }); clearClientSession(); setPassword(''); setConfirmation(''); setMessage(data.message || 'Your password has been reset. Sign in with your new password.'); setComplete(true); window.history.replaceState({}, '', '/reset-password/complete') } catch (err) { setMessage(err.message) } finally { setBusy(false) }
  }
  return <RecoveryShell><p className="eyebrow">Secure password reset</p><h1>Choose a new<br /><em>password.</em></h1>{complete ? <div className="success"><p role="status">{message}</p><Link className="button button-dark" to="/?apply=1">Return to sign in</Link></div> : <form onSubmit={submit}><label className="portal-field">New password<input required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 15 characters" /></label><label className="portal-field">Confirm new password<input required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>{message && <p className="form-error" role="alert">{message}</p>}<button disabled={busy} className="button button-dark full" type="submit">{busy ? 'Resetting…' : 'Reset password'}</button></form>}</RecoveryShell>
}
export function VerifyEmailPage() {
  const { token } = useParams()
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [message, setMessage] = useState('')
  const verify = async () => {
    setBusy(true); setMessage('')
    try { const result = await api('/api/auth/verify-email', { method: 'POST', auth: false, body: { token } }); setComplete(true); setMessage(result.message || 'Email verified. You can now sign in.'); window.history.replaceState({}, '', '/verify-email/complete') } catch (err) { setMessage(err.message) } finally { setBusy(false) }
  }
  return <RecoveryShell><p className="eyebrow">Email verification</p><h1>Verify your email</h1><p>Confirm this is the email address you want to use for your account.</p>{message && <p role={complete ? 'status' : 'alert'}>{message}</p>}{complete ? <Link className="button button-dark" to="/?apply=1">Continue to sign in</Link> : <button className="button button-dark" disabled={busy} onClick={verify}>{busy ? 'Verifying…' : 'Verify email address'}</button>}</RecoveryShell>
}
