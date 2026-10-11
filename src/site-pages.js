// Content scopes are independent of credentials, language and navigation state.
const hash = value => {
  let result = 2166136261
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0), 16777619)
  return (result >>> 0).toString(36)
}
const bounded = (prefix, value) => {
  const slug = value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
  return `${prefix}.${slug.slice(0, 72)}${slug !== value || slug.length > 72 ? `-${hash(value)}` : ''}`
}
export function canManageContent(user) {
  return user?.role === 'admin' || (user?.role === 'moderator' && user.permissions?.manageContent === true)
}
export function contentPage(pathname, search = '', user = null) {
  const path = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)
  if (path === '/') {
    if (params.has('auth')) return { key: 'sign-in', label: 'Student sign in', path: '/?auth=1' }
    if (params.get('apply') === '1') return { key: user ? 'student-account' : 'sign-in', label: user ? 'Student account' : 'Student sign in', path: '/?apply=1' }
    return { key: 'home', label: 'Homepage', path: '/' }
  }
  // Never use one-use recovery/verification tokens in a public content key.
  if (/^\/reset-password(?:\/|$)/.test(path)) return { key: 'reset-password', label: 'Reset password', path: '/reset-password/preview' }
  if (/^\/verify-email(?:\/|$)/.test(path)) return { key: 'verify-email', label: 'Verify email', path: '/verify-email/preview' }
  if (/^\/advisor(?:\/|$)/.test(path)) return { key: 'advisor', label: 'Adviser workspace', path: '/advisor' }
  if (/^\/admin(?:\/|$)/.test(path)) return { key: 'admin', label: 'Admin dashboard', path: '/admin' }
  const known = editorPages.find(page => page.path === path)
  if (known) return known
  if (path.startsWith('/blog/')) return { key: bounded('blog', path.slice(6)), label: `Article: ${path.slice(6).replaceAll('-', ' ')}`, path }
  if (path.startsWith('/universities/')) return { key: bounded('university', path.slice(14)), label: path.slice(14).replaceAll('-', ' '), path }
  return { key: `page.${hash(path)}`, label: path, path }
}
export const editorPages = [
  { key: 'home', path: '/', label: 'Homepage' },
  { key: 'free-student-advisory', path: '/free-student-advisory', label: 'Free Student Advisory' },
  { key: 'study-in-uk', path: '/study-in-uk', label: 'Study in the UK' },
  { key: 'university-admission', path: '/university-admission', label: 'University Admission' },
  { key: 'blog', path: '/blog', label: 'Blog' },
  { key: 'terms', path: '/terms', label: 'Terms and conditions' },
  { key: 'privacy', path: '/privacy', label: 'Privacy notice' },
  { key: 'sign-in', path: '/?auth=1', label: 'Student sign in' },
  { key: 'student-account', path: '/?apply=1', label: 'Student account' },
  { key: 'forgot-password', path: '/forgot-password', label: 'Forgot password' },
  { key: 'reset-password', path: '/reset-password/preview', label: 'Reset password' },
  { key: 'verify-email', path: '/verify-email/preview', label: 'Verify email' },
  { key: 'advisor', path: '/advisor', label: 'Adviser workspace' },
  { key: 'admin', path: '/admin', label: 'Admin dashboard' },
]

export function editorUrl(path, editing) {
  const url = new URL(path, 'https://site.invalid')
  if (url.origin !== 'https://site.invalid' || path.startsWith('//')) return null
  if (editing) url.searchParams.set('edit', '1')
  else url.searchParams.delete('edit')
  return url.pathname + url.search + url.hash
}
