import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './theme-toggle.css'

const storageKey = 'student_advisor_theme'
const ThemeContext = createContext(null)
const validTheme = value => value === 'light' || value === 'dark'
function savedTheme() {
  try {
    const value = localStorage.getItem(storageKey)
    return validTheme(value) ? value : null
  } catch { return null }
}
const systemTheme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151a21' : '#f15436')
}

export function ThemeProvider({ children }) {
  const preference = useRef(savedTheme())
  const [theme, setTheme] = useState(() => preference.current || systemTheme())
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const followSystem = () => {
      if (!preference.current) setTheme(systemTheme())
    }
    const syncStorage = event => {
      if (event.storageArea && event.storageArea !== window.localStorage) return
      if (event.key !== storageKey && event.key !== null) return
      preference.current = validTheme(event.newValue) ? event.newValue : null
      setTheme(preference.current || systemTheme())
    }
    followSystem()
    media?.addEventListener('change', followSystem)
    window.addEventListener('storage', syncStorage)
    return () => {
      media?.removeEventListener('change', followSystem)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    preference.current = next
    try { localStorage.setItem(storageKey, next) } catch { /* Still switch for this visit. */ }
    applyTheme(next)
    setTheme(next)
  }
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export default function ThemeToggle() {
  const { theme, toggleTheme } = useContext(ThemeContext)
  const { i18n } = useTranslation()
  const dark = theme === 'dark'
  const label = i18n.resolvedLanguage?.startsWith('ro')
    ? (dark ? 'Activează modul luminos' : 'Activează modul de noapte')
    : (dark ? 'Switch to light mode' : 'Switch to night mode')
  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={label} title={label}>
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></> : <path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z" />}
    </svg>
  </button>
}
