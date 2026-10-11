export const supportedLocales = ['en', 'ro']
export const defaultLocale = 'en'

export function localeFromPath(pathname = '/') {
  const match = String(pathname).match(/^\/(en|ro)(?:\/|$)/)
  return match?.[1] || null
}

export function stripLocale(pathname = '/') {
  const clean = String(pathname).replace(/^\/(?:en|ro)(?=\/|$)/, '') || '/'
  return clean.startsWith('/') ? clean : `/${clean}`
}

export function localizedPath(pathname = '/', locale = defaultLocale) {
  const language = supportedLocales.includes(locale) ? locale : defaultLocale
  const clean = stripLocale(pathname).replace(/\/+$/, '') || '/'
  return clean === '/' ? `/${language}/` : `/${language}${clean}`
}

export function localeAlternates(pathname = '/') {
  return Object.fromEntries(supportedLocales.map(locale => [locale, localizedPath(pathname, locale)]))
}
