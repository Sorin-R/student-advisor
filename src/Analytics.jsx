import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { analyticsConsent, flushAnalytics, setAnalyticsConsent, track, trackAction } from './analytics.js'

const sectionKey = element => String(element?.dataset.analyticsSection || (/^section-\d+$/.test(element?.id || '') ? element.querySelector('h2')?.textContent : '') || element?.id || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 120) || null

export function AnalyticsTracker() {
  const { pathname } = useLocation()
  useEffect(() => {
    const path = pathname || '/'
    if (/^\/(admin|advisor)(?:\/|$)/.test(path)) return
    let lastTick = Date.now()
    const activeSections = new Map()
    const seenSections = new Set()
    const reportTime = () => {
      const now = Date.now(), seconds = Math.floor((now - lastTick) / 1000)
      if (seconds > 0 && document.visibilityState === 'visible') track({ type: 'page_time', path, durationSeconds: Math.min(seconds, 3600) })
      lastTick = now
      for (const [element, startedAt] of activeSections) {
        const durationSeconds = document.visibilityState === 'visible' ? Math.floor((now - startedAt) / 1000) : 0
        if (durationSeconds > 0) track({ type: 'section_time', path, section: sectionKey(element), durationSeconds: Math.min(durationSeconds, 3600) })
        activeSections.set(element, now)
      }
      flushAnalytics()
    }
    if (analyticsConsent() === 'granted') track({ type: 'page_view', path })
    const onConsentChange = () => {
      if (analyticsConsent() !== 'granted') return
      lastTick = Date.now()
      track({ type: 'page_view', path })
      document.querySelectorAll('main section[id], main [data-analytics-section]').forEach(element => {
        const rect = element.getBoundingClientRect(), visible = rect.bottom > 0 && rect.top < window.innerHeight
        if (!visible) return
        const section = sectionKey(element)
        if (!seenSections.has(section)) { seenSections.add(section); track({ type: 'section_view', path, section }) }
        activeSections.set(element, Date.now())
      })
    }
    const timer = window.setInterval(reportTime, 15_000)
    const onVisibility = () => { if (document.visibilityState === 'hidden') reportTime(); else lastTick = Date.now() }
    const onPageHide = () => { reportTime(); flushAnalytics() }
    const onClick = event => {
      const control = event.target.closest?.('a[href],button,[role="button"],input[type="submit"]')
      if (!control || control.disabled || control.closest('[data-analytics-ignore],.site-editor')) return
      const scoped = control.closest('[data-analytics-label]')
      const university = control.closest('[data-analytics-university]')?.dataset.analyticsUniversity
      const section = sectionKey(control.closest('section[id],[data-analytics-section]')) || (control.closest('header,nav') ? 'site-navigation' : control.closest('footer') ? 'footer' : 'page-body')
      const action = control.dataset.analyticsAction || control.dataset.analyticsLabel || scoped?.dataset.analyticsLabel || null
      const display = control.dataset.analyticsName || control.getAttribute('aria-label') || control.innerText || control.textContent || ''
      const label = String(display).replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!label || /[^\p{L}\p{N} _.,:()&'’!?/-]/u.test(label) || /\b\S+@\S+\.\S+\b/.test(label)) return
      const target = university ? `university:${university}:${label}` : label
      trackAction({ type: 'action_click', target, action, path, section })
    }
    const startedForms = new WeakSet()
    const onFocus = event => {
      const form = event.target.closest?.('form')
      if (!form || startedForms.has(form) || form.closest('[data-analytics-ignore],.site-editor')) return
      startedForms.add(form)
      track({ type: 'form_start', target: form.dataset.analyticsName || form.dataset.analyticsLabel || 'form', path, section: sectionKey(form.closest('section[id],[data-analytics-section]')) })
    }
    const onSubmit = event => {
      const form = event.target
      if (form?.tagName !== 'FORM' || form.closest('[data-analytics-ignore],.site-editor')) return
      if (form.dataset.analyticsLabel) return
      track({ type: 'form_submit', target: form.dataset.analyticsLabel || 'form', path })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target, section = sectionKey(element)
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          if (!seenSections.has(section)) { seenSections.add(section); track({ type: 'section_view', path, section }) }
          if (!activeSections.has(element)) activeSections.set(element, Date.now())
        } else if (activeSections.has(element)) {
          const durationSeconds = Math.floor((Date.now() - activeSections.get(element)) / 1000)
          if (durationSeconds > 0) track({ type: 'section_time', path, section, durationSeconds: Math.min(durationSeconds, 3600) })
          activeSections.delete(element)
        }
      }
    }, { threshold: [0, 0.35, 0.6] })
    document.querySelectorAll('main section[id], main [data-analytics-section]').forEach(element => observer?.observe(element))
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('student-advisor-analytics-consent-change', onConsentChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      reportTime(); window.clearInterval(timer); observer?.disconnect()
      document.removeEventListener('click', onClick, true); document.removeEventListener('focusin', onFocus, true); document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('student-advisor-analytics-consent-change', onConsentChange); window.removeEventListener('pagehide', onPageHide); flushAnalytics()
    }
  }, [pathname])
  return null
}

export default function AnalyticsConsent() {
  const { pathname } = useLocation()
  const [choice, setChoice] = useState(() => analyticsConsent())
  const [open, setOpen] = useState(() => !analyticsConsent())
  const choose = value => { setAnalyticsConsent(value); setChoice(value ? 'granted' : 'denied'); setOpen(false); window.dispatchEvent(new Event('student-advisor-analytics-consent-change')) }
  if (/^\/(admin|advisor)(?:\/|$)/.test(pathname || '/')) return null
  return <div className="analytics-consent" data-analytics-ignore>
    <button className="analytics-preferences-toggle" onClick={() => setOpen(value => !value)}>{choice === 'granted' ? 'Privacy choices · analytics on' : choice === 'denied' ? 'Privacy choices · analytics off' : 'Privacy choices'}</button>
    {open && <section className="analytics-consent-panel" role="dialog" aria-label="Optional website analytics">
      <h2>Help us improve the website</h2>
      <p>With your permission, we measure pages and sections viewed, button and link labels, keywords entered in the Find your next step university and course finder, action completion, and time spent. We use a random browser ID and do not collect form contents, names, email addresses, documents, or advertising identifiers. You can change this choice at any time. Analytics events are kept for up to 90 days.</p>
      <div><button className="button button-dark" onClick={() => choose(true)}>Allow analytics</button><button onClick={() => choose(false)}>Decline</button></div>
    </section>}
  </div>
}
