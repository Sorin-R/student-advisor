import { useSiteEditor } from './editor-context'

// These components are inserted by the JSX build plugin. Outside edit mode,
// text stays a text node and images keep their native DOM/layout.
export function AutoEditableText({ field, children }) {
  const editor = useSiteEditor()
  if (typeof children !== 'string') return children
  const value = editor?.textValue(field, children) ?? children
  if (!editor?.mode) return value
  const label = children.trim().replace(/\s+/g, ' ').slice(0, 75) || 'Page text'
  const edit = event => {
    event.preventDefault(); event.stopPropagation()
    editor.chooseText(field, label, children)
  }
  return <span className="site-editable site-auto-editable" data-site-editable={field} role="button" tabIndex={0} aria-label={`Edit ${label}`} title={`Edit ${label}`} onClick={edit} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') edit(event) }}>{value || <span aria-hidden="true">Empty text</span>}</span>
}

export function AutoEditableImage({ field, src, alt, ...props }) {
  const editor = useSiteEditor()
  const value = editor?.imageValue(field, src) ?? src
  if (!editor?.mode) return <img {...props} srcSet={value !== src ? undefined : props.srcSet} src={value} alt={alt} />
  const label = alt || 'Page image'
  return <span className="site-editable site-auto-image" data-site-editable={field}><img {...props} srcSet={value !== src ? undefined : props.srcSet} src={value} alt={alt} /><button type="button" className="site-edit-button" onClick={event => { event.preventDefault(); event.stopPropagation(); editor.chooseImage(field, label, src) }}>Edit image</button></span>
}
