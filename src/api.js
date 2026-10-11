// Authentication is held in memory. The HttpOnly cookie is used only for renewal.
let session = { accessToken: '', user: null, ready: false }
let renewal = null
let signingOut = null
let epoch = 0
let explicitlySignedOut = false
const listeners = new Set()
const nativeFetch = (...args) => globalThis.fetch(...args)
const withCookieLock = task => globalThis.navigator?.locks?.request ? globalThis.navigator.locks.request('student-advisor-auth-cookie', task) : task()
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('student-advisor-session') : null
if (channel) channel.onmessage = event => { if (event.data === 'signed-out') clearClientSession(false) }

export function clearSensitiveStorage() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = globalThis[storageName]
      if (!storage) continue
      for (const key of Object.keys(storage)) {
        if (key.startsWith('student_advisor_') && !['student_advisor_language', 'student_advisor_theme'].includes(key)) storage.removeItem(key)
      }
    } catch { /* Storage may be unavailable in private browsing. */ }
  }
}
clearSensitiveStorage()
export const getSession = () => session
export const subscribeSession = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
function publish(next) { session = next; listeners.forEach(listener => listener()) }
export function clearClientSession(broadcast = true) {
  epoch += 1
  explicitlySignedOut = true
  clearSensitiveStorage()
  publish({ accessToken: '', user: null, ready: true })
  if (broadcast) channel?.postMessage('signed-out')
}
export function acceptSession(result) {
  if (!result?.accessToken || !result?.user) throw new Error('The server did not return a complete session. Please sign in again.')
  epoch += 1
  explicitlySignedOut = false
  clearSensitiveStorage()
  publish({ accessToken: result.accessToken, user: result.user, ready: true })
  return result
}
export async function responseData(response) {
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error?.message || (typeof data.error === 'string' ? data.error : '') || data.message || `Request failed (${response.status}). Please try again.`)
    error.status = response.status
    error.code = data.code || data.error?.code
    error.details = data
    throw error
  }
  return data
}
export async function refreshSession() {
  if (explicitlySignedOut) return null
  if (renewal) return renewal
  const startedEpoch = epoch
  const expectedUserId = session.user?.id
  renewal = withCookieLock(async () => {
    try {
      if (startedEpoch !== epoch || explicitlySignedOut) return null
      const response = await nativeFetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!response.ok) {
        if (response.status === 401) { if (startedEpoch === epoch) publish({ accessToken: '', user: null, ready: true }); return null }
        await responseData(response)
      }
      const result = await responseData(response)
      if (!result.accessToken || !result.user) throw new Error('The server did not return a complete session.')
      if (startedEpoch !== epoch || explicitlySignedOut) return null
      if (expectedUserId && result.user.id !== expectedUserId) {
        epoch += 1; explicitlySignedOut = true
        publish({ accessToken: '', user: null, ready: true })
        const error = new Error('The signed-in account changed in another tab. Please sign in again before continuing.')
        error.code = 'ACCOUNT_CHANGED'
        throw error
      }
      publish({ accessToken: result.accessToken, user: result.user, ready: true })
      return result
    } catch (error) {
      if (error.code === 'ACCOUNT_CHANGED') throw error
      if (startedEpoch === epoch && !session.ready) publish({ ...session, ready: true })
      throw new Error('Unable to connect. Check your connection and try again.', { cause: error })
    } finally { renewal = null }
  })
  return renewal
}
export async function apiFetch(url, options = {}) {
  const { auth = true, ...requestOptions } = options
  const authEndpoint = String(url).startsWith('/api/auth/') && !String(url).startsWith('/api/auth/security')
  const protectedRequest = auth && !authEndpoint
  const request = () => {
    const headers = new Headers(requestOptions.headers)
    // Ignore legacy caller tokens; the current shared session is authoritative.
    headers.delete('Authorization')
    if (protectedRequest && session.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`)
    return nativeFetch(url, { ...requestOptions, headers, credentials: 'include', cache: 'no-store' })
  }
  try {
    const requestedToken = session.accessToken
    let response = await request()
    if (response.status === 401 && protectedRequest && !explicitlySignedOut) {
      const reason = await response.clone().json().catch(() => ({}))
      if (reason.code === 'REAUTHENTICATION_REQUIRED') return response
      if (session.accessToken && session.accessToken !== requestedToken) response = await request()
      else if ((await refreshSession())?.accessToken) response = await request()
    }
    return response
  } catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new Error('Unable to connect. Check your connection and try again.', { cause: error }) }
}
export async function api(url, options = {}) {
  const { body, ...rest } = options
  return responseData(await apiFetch(url, {
    ...rest,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...rest.headers } }),
  }))
}
export async function logout() {
  if (signingOut) return signingOut
  signingOut = withCookieLock(async () => {
    // Await the server so the UI never claims a remaining refresh session was revoked.
    const response = await nativeFetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}) }, body: '{}' })
    await responseData(response)
    clearClientSession()
  }).finally(() => { signingOut = null })
  return signingOut
}
