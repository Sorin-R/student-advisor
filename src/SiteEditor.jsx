import { useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, apiFetch, responseData } from './api'
import { useSessionBootstrap } from './AccountSecurity'
import { EditorContext } from './editor-context'
import { canManageContent, contentPage, editorPages, editorUrl } from './site-pages'
import { universities, universitySlug } from './universities'
import './site-editor.css'
export { useSiteEditor } from './editor-context'
const empty = Object.freeze({})
const editingStored = () => { try { return sessionStorage.getItem('website-edit-mode') === '1' } catch { return false } }

function ContentEditorDialog({ selected, textValue, onClose, onSaveText, onSaveImage, onReset, busy, error }) {
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState(null)
  const input = useRef(null)
  useEffect(() => {
    setDraft(selected?.type === 'text' ? textValue(selected.field, selected.fallback) : '')
    setFile(null)
    const previous = document.activeElement
    input.current?.focus()
    return () => previous?.focus?.()
  }, [selected])
  if (!selected) return null
  const submit = event => { event.preventDefault(); if (selected.type === 'image') onSaveImage(selected.field, file); else onSaveText(selected.field, draft) }
  return <div className="site-editor-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled),textarea,input')]
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
  }}>
    <form className="site-editor-dialog" role="dialog" aria-modal="true" onSubmit={submit} aria-label={`Edit ${selected.label}`}>
      <div className="site-editor-dialog-heading"><div><span>Edit content</span><h2>{selected.label}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close editor">×</button></div>
      {selected.type === 'image' ? <><p>Choose a JPEG, PNG, WebP or AVIF image. It will be resized and converted to WebP.</p><label className="site-editor-file">Replacement image<input ref={input} required type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={event => setFile(event.target.files?.[0] || null)} /></label></> : <label className="site-editor-textarea">Text<textarea ref={input} maxLength={5000} rows={6} value={draft} onChange={event => setDraft(event.target.value)} /></label>}
      {error && <p className="site-editor-error" role="alert">{error}</p>}
      <div className="site-editor-dialog-actions"><button type="button" disabled={busy} onClick={onReset}>Restore original</button><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="site-editor-save" disabled={busy || (selected.type === 'image' && !file)}>{busy ? 'Publishing…' : 'Save and publish'}</button></div>
    </form>
  </div>
}

export function SiteEditorProvider({ children }) {
  const { i18n } = useTranslation()
  const session = useSessionBootstrap()
  const location = useLocation()
  const navigate = useNavigate()
  const language = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  const allowed = canManageContent(session.user)
  const [enabled, setEnabled] = useState(() => new URLSearchParams(window.location.search).get('edit') === '1' || editingStored())
  const [editing, setEditing] = useState(true)
  const page = contentPage(location.pathname, location.search, session.user)
  const textKey = `ui.${page.key}.${language}`, mediaKey = `ui.${page.key}.media`
  const scope = `${textKey}:${mediaKey}`
  const currentScope = useRef(scope); currentScope.current = scope
  const [content, setContent] = useState({ scope: '', text: empty, media: empty })
  const [selected, setSelected] = useState(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [discovered, setDiscovered] = useState([])
  const mode = enabled && allowed && editing
  const preview = enabled && allowed && ['student-account', 'advisor', 'admin'].includes(page.key)
  const textContent = content.scope === scope ? content.text : empty
  const mediaContent = content.scope === scope ? content.media : empty
  useEffect(() => {
    if (new URLSearchParams(location.search).get('edit') === '1') setEnabled(true)
  }, [location.search])
  useEffect(() => {
    if (!session.ready) return
    try { if (enabled && allowed) sessionStorage.setItem('website-edit-mode', '1'); else sessionStorage.removeItem('website-edit-mode') } catch { /* optional persistence */ }
  }, [enabled, allowed, session.ready])
  useEffect(() => {
    let active = true
    setSelected(null); setError(''); setNotice('')
    Promise.all([api(`/api/content/${textKey}`, { auth: false }), api(`/api/content/${mediaKey}`, { auth: false })]).then(([text, media]) => {
      if (active) setContent({ scope, text: text.value || empty, media: media.value || empty })
    }).catch(() => { if (active) { setContent({ scope, text: empty, media: empty }); setError('Published content could not be loaded. Refresh before editing.') } })
    return () => { active = false }
  }, [scope])
  useEffect(() => {
    if (!enabled || !allowed) return
    const collect = () => {
      const found = [...document.querySelectorAll('a[href]')].flatMap(link => {
        const url = new URL(link.href, window.location.origin)
        if (url.origin !== window.location.origin || url.pathname.startsWith('/api/') || /\.[a-z0-9]+$/i.test(url.pathname)) return []
        return [contentPage(url.pathname, url.search, session.user)]
      })
      setDiscovered(previous => { const map = new Map(previous.map(item => [item.key, item])); found.forEach(item => map.set(item.key, item)); return map.size === previous.length ? previous : [...map.values()] })
    }
    collect()
    const timer = window.setTimeout(collect, 1000)
    return () => window.clearTimeout(timer)
  }, [location.pathname, enabled, allowed])
  const textValue = (field, fallback) => Object.hasOwn(textContent, field) ? textContent[field] : fallback
  const imageValue = (field, fallback) => Object.hasOwn(mediaContent, field) ? mediaContent[field] : fallback
  const choose = (type, field, label, fallback) => { if (mode && content.scope === scope) { setError(''); setSelected({ type, field, label, fallback }) } }
  const saveField = async (key, field, value, type) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api(`/api/admin/content/${key}/field`, { method: 'PATCH', body: { field, value } })
      if (currentScope.current !== scope) return
      setContent(current => ({ ...current, [type]: result.value })); setSelected(null); setNotice(value === null ? 'Original restored.' : 'Text published.')
    } catch (err) { if (currentScope.current === scope) setError(err.message) } finally { setBusy(false) }
  }
  const saveImage = async (field, file) => {
    if (!file || busy) return
    setBusy(true); setError('')
    try {
      const body = new FormData(); body.append('field', field); body.append('image', file)
      const result = await responseData(await apiFetch(`/api/admin/content/${mediaKey}/image`, { method: 'POST', body }))
      if (currentScope.current !== scope) return
      setContent(current => ({ ...current, media: result.value })); setSelected(null); setNotice('Image published.')
    } catch (err) { if (currentScope.current === scope) setError(err.message) } finally { setBusy(false) }
  }
  const toggle = value => {
    setEnabled(value); setEditing(true); setSelected(null)
    try { if (value) sessionStorage.setItem('website-edit-mode', '1'); else sessionStorage.removeItem('website-edit-mode') } catch { /* optional persistence */ }
    navigate(editorUrl(location.pathname + location.search + location.hash, value), { replace: true })
  }
  const pages = [...new Map([...editorPages, ...universities.map(item => contentPage(`/universities/${universitySlug(item.name)}`)), ...discovered, page].map(item => [item.key, item])).values()]
  const context = { mode, enabled: enabled && allowed, preview, textValue, imageValue, chooseText: (...args) => choose('text', ...args), chooseImage: (...args) => choose('image', ...args) }
  const capture = event => {
    if (!enabled || !allowed) return
    if (event.target.closest('.site-editable, .site-edit-button')) return
    const anchor = event.target.closest('a[href]')
    if (anchor) {
      const url = new URL(anchor.href, window.location.origin)
      if (url.origin === window.location.origin && !url.pathname.startsWith('/api/') && !anchor.download && !event.metaKey && !event.ctrlKey) {
        event.preventDefault(); event.stopPropagation(); navigate(editorUrl(url.pathname + url.search + url.hash, true)); return
      }
    }
    // Synthetic account previews never submit requests or change an account.
    if ((preview || ['sign-in', 'forgot-password', 'reset-password', 'verify-email'].includes(page.key)) && event.target.closest('button,input[type=submit]') && !event.target.closest('[data-preview-navigation],.theme-toggle,.language-switcher')) { event.preventDefault(); event.stopPropagation() }
  }
  return <EditorContext.Provider value={context}>
    {allowed && <div className="site-editor-toolbar" role="region" aria-label="Website edit mode">
      {enabled ? <><strong>{mode ? 'Edit Mode' : 'Preview Mode'}</strong><select aria-label="Page to edit" value={page.key} disabled={busy} onChange={event => navigate(editorUrl(pages.find(item => item.key === event.target.value).path, true))}>{pages.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><span>{language.toUpperCase()} · {preview ? 'Sample account · ' : ''}Changes publish immediately</span><button onClick={() => setEditing(value => !value)}>{mode ? 'Preview' : 'Resume editing'}</button><button onClick={() => toggle(false)}>Exit</button></> : <button onClick={() => toggle(true)}>Edit this page</button>}
      {notice && <b role="status">{notice}</b>}{enabled && error && !selected && <b role="alert">{error}</b>}
    </div>}
    <div className={enabled && allowed ? 'site-editor-active' : undefined} key={preview ? `preview:${page.key}` : 'site'} onClickCapture={capture} onSubmitCapture={event => { if (enabled && allowed) { event.preventDefault(); event.stopPropagation() } }}>{children}</div>
    <ContentEditorDialog selected={selected} textValue={textValue} onClose={() => { if (!busy) setSelected(null) }} onSaveText={(field, value) => saveField(textKey, field, value, 'text')} onSaveImage={saveImage} onReset={() => saveField(selected.type === 'image' ? mediaKey : textKey, selected.field, null, selected.type === 'image' ? 'media' : 'text')} busy={busy} error={error} />
  </EditorContext.Provider>
}

export function EditableText({ field, label, children, embedded = false }) {
  const editor = useContext(EditorContext)
  const fallback = typeof children === 'string' ? children : String(children ?? '')
  const value = editor?.textValue(field, fallback) ?? fallback
  const edit = event => { event.preventDefault(); event.stopPropagation(); editor.chooseText(field, label, fallback) }
  return <span className={editor?.mode ? `site-editable site-editable-text${embedded ? ' site-editable-embedded' : ''}` : undefined} {...(editor?.mode && embedded ? { role: 'button', tabIndex: 0, title: `Edit ${label}`, onClick: edit, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') edit(event) } } : {})}>{value}{editor?.mode && !embedded && <button type="button" className="site-edit-button" onClick={edit}>Edit</button>}</span>
}

export function EditableImage({ field, label, className, fallback, overlay = '' }) {
  const editor = useContext(EditorContext)
  const value = editor?.imageValue(field, fallback) ?? fallback
  const backgroundImage = value && value !== fallback ? `${overlay ? `${overlay},` : ''}url("${String(value).replaceAll('"', '%22')}")` : undefined
  return <div className={`${className} ${editor?.mode ? 'site-editable site-editable-image' : ''}`} style={backgroundImage ? { backgroundImage } : undefined}>{editor?.mode && <button type="button" className="site-edit-button" onClick={event => { event.preventDefault(); event.stopPropagation(); editor.chooseImage(field, label, fallback) }}>Edit image</button>}</div>
}

export function EditableInlineImage({ field, label, fallback, alt }) {
  const editor = useContext(EditorContext)
  const value = editor?.imageValue(field, fallback) ?? fallback
  return <span className={editor?.mode ? 'site-editable site-editable-inline-image' : 'site-editable-inline-image'}><img src={value} alt={alt} />{editor?.mode && <button type="button" className="site-edit-button" onClick={event => { event.preventDefault(); event.stopPropagation(); editor.chooseImage(field, label, fallback) }}>Edit image</button>}</span>
}
