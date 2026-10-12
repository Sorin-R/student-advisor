const CONSENT_KEY = 'student-advisor-analytics-consent-v3'
const VISITOR_KEY = 'student-advisor-analytics-visitor'
const SESSION_KEY = 'student-advisor-analytics-session'
let queue = []
let pendingAction = null

function consented() { try { return localStorage.getItem(CONSENT_KEY) === 'granted' } catch { return false } }
function getId(storage, key) {
  try {
    let id = storage.getItem(key)
    if (!id) { id = crypto.randomUUID(); storage.setItem(key, id) }
    return id
  } catch { return null }
}
function safePage(path) {
  return String(path || '/').split(/[?#]/, 1)[0].replace(/\/(verify-email|reset-password)\/[^/]+/gi, '/$1/:token').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').slice(0, 180) || '/'
}
export function track(event) {
  if (!consented()) return
  const visitorId = getId(localStorage, VISITOR_KEY), sessionId = getId(sessionStorage, SESSION_KEY)
  if (!visitorId || !sessionId) return
  queue.push({ ...event, visitorId, sessionId, path: safePage(event.path || location.pathname) })
  if (queue.length >= 20) flushAnalytics()
}
export function flushAnalytics() {
  if (!queue.length || !consented()) { queue = []; return }
  const events = queue.splice(0, 40)
  const body = JSON.stringify({ events })
  if (navigator.sendBeacon?.('/api/analytics/events', new Blob([body], { type: 'application/json' }))) return
  fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {})
}
export function setAnalyticsConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value ? 'granted' : 'denied')
    if (value) { getId(localStorage, VISITOR_KEY); getId(sessionStorage, SESSION_KEY) }
    else { queue = []; pendingAction = null; localStorage.removeItem(VISITOR_KEY); sessionStorage.removeItem(SESSION_KEY) }
  } catch { /* Analytics remains off if browser storage is unavailable. */ }
}
export function analyticsConsent() { try { return localStorage.getItem(CONSENT_KEY) || '' } catch { return '' } }
export function trackRequestOutcome(url, method, body, ok) {
  if (!consented()) return
  if (/^\/(admin|advisor)(?:\/|$)/.test(location.pathname || '/')) return
  const path = String(url).split(/[?#]/, 1)[0]
  let action = null
  if (/^\/api\/applications\/[0-9a-f-]+$/.test(path) && method === 'PUT') action = body?.status === 'submitted' ? 'application_submit' : 'application_save'
  else if (path === '/api/support-messages' && method === 'POST') action = 'support_enquiry'
  else if (/^\/api\/support-messages\/[0-9a-f-]+\/replies$/.test(path) && method === 'POST') action = 'message_reply'
  else if (path === '/api/me/profile' && method === 'PUT') action = 'profile_save'
  else if (/^\/api\/applications\/[0-9a-f-]+\/documents$/.test(path) && method === 'PATCH') action = 'documents_upload'
  else if (path === '/api/auth/register' && method === 'POST') action = 'account_registration'
  else if (path === '/api/auth/login' && method === 'POST') action = 'sign_in'
  if (!action) return
  const pending = pendingAction?.action === action && Date.now() - pendingAction.clickedAt < 60_000 ? pendingAction : null
  const details = { target: pending?.target || action, path: pending?.path || location.pathname, section: pending?.section || null }
  track({ type: 'form_submit', ...details })
  track({ type: ok ? 'action_success' : 'action_failure', ...details })
  pendingAction = null
}
export function trackAction(event) { track(event); pendingAction = { ...event, clickedAt: Date.now() } }
export function getPendingAnalyticsAction() { return pendingAction }
export function trackCourseSearch(value) {
  if (!consented()) return
  const query = String(value || '').trim()
  if (query.length < 2 || query.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} &,'()./-]*$/u.test(query)) return
  const normalized = query.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  if (normalized) track({ type: 'course_search', target: normalized, path: location.pathname, section: 'explore' })
}
