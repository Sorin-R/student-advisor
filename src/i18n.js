import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { localeFromPath, localizedPath } from './locale-routes'

const queryLanguage = new URLSearchParams(window.location.search).get('lang')
const pathLanguage = localeFromPath(window.location.pathname)
let storedLanguage
try { storedLanguage = localStorage.getItem('student_advisor_language') } catch { /* Preferences are optional when browser storage is disabled. */ }
const initialLanguage = pathLanguage || (['en', 'ro'].includes(queryLanguage) ? queryLanguage : (['en', 'ro'].includes(storedLanguage) ? storedLanguage : 'en'))

i18n.use(initReactI18next).init({
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ro'],
  ns: ['translation'],
  defaultNS: 'translation',
  backend: undefined,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  resources: {},
})

export async function loadTranslations() {
  const responses = await Promise.all(['en', 'ro'].map((language) => fetch(`/locales/${language}/translation.json`).then((response) => {
    if (!response.ok) throw new Error(`Unable to load ${language} translations`)
    return response.json()
  })))
  responses.forEach((resources, index) => i18n.addResourceBundle(['en', 'ro'][index], 'translation', resources, true, true))
  await i18n.changeLanguage(initialLanguage)
  document.documentElement.lang = initialLanguage
}

export async function changeLanguage(language) {
  if (!['en', 'ro'].includes(language)) return
  try { localStorage.setItem('student_advisor_language', language) } catch { /* Keep the selection for this visit. */ }
  document.documentElement.lang = language
  await i18n.changeLanguage(language)
  const url = new URL(window.location.href)
  url.searchParams.delete('lang')
  const destination = localizedPath(url.pathname, language) + url.search + url.hash
  if (destination !== url.pathname + url.search + url.hash) window.location.assign(destination)
}

export default i18n
