import ThemeToggle from './ThemeToggle'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { EditableText } from './SiteEditor'

export default function PrivacyPage() {
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/privacy', { signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Privacy information is temporarily unavailable.')
      setNotice(body)
    }).catch((reason) => { if (reason.name !== 'AbortError') setError('Privacy information is temporarily unavailable. Please contact Student Advisor before sending personal documents.') })
    return () => controller.abort()
  }, [])
  return <div className="portal-page terms-page">
    <Helmet><title>Privacy notice | Student Advisor</title><meta name="robots" content="noindex" /></Helmet>
    <div className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><Link to="/">Back to website</Link></div>
    <main className="terms-content"><p className="eyebrow">Your information</p><h1><EditableText field="hero.title" label="Privacy notice heading">Privacy notice</EditableText></h1>
      {error ? <p role="alert">{error}</p> : !notice ? <p role="status">Loading privacy information…</p> : <>
        <p>Data controller: <EditableText field="controller" label="Privacy controller display name">{notice.controller}</EditableText></p><p>Contact: <a href={`mailto:${notice.contactEmail}`}><EditableText field="contact.email" label="Privacy contact display text" embedded>{notice.contactEmail}</EditableText></a></p><p>Last updated: <EditableText field="updated" label="Privacy notice update date">{notice.updated}</EditableText></p>
        {notice.sections.map((section, index) => <section key={index}><h2><EditableText field={`section${index + 1}.heading`} label={`Privacy section ${index + 1} heading`}>{section.title}</EditableText></h2>{section.body.split('\n\n').map((paragraph, p) => <p key={p}><EditableText field={`section${index + 1}.paragraph${p + 1}`} label={`Privacy section ${index + 1}, paragraph ${p + 1}`}>{paragraph}</EditableText></p>)}</section>)}
      </>}
    </main>
  </div>
}
