import test from 'node:test'
import assert from 'node:assert/strict'
import { transformSync } from '@babel/core'
import automaticContentPlugin from '../scripts/automatic-content-plugin.mjs'

const root = '/website'
function transform(source, filename = 'src/FuturePage.jsx') {
  return transformSync(source, {
    filename: `${root}/${filename}`, cwd: root, configFile: false, babelrc: false,
    parserOpts: { plugins: ['jsx'] }, plugins: [automaticContentPlugin], ast: true, code: true,
  })
}

function editorNodes(ast, name = '_AutoEditableText') {
  const found = []
  function walk(value) {
    if (!value || typeof value !== 'object') return
    if (value.type === 'JSXElement' && value.openingElement.name.name === name) found.push(value)
    for (const [key, child] of Object.entries(value)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue
      if (Array.isArray(child)) child.forEach(walk)
      else walk(child)
    }
  }
  walk(ast)
  return found
}
const fieldOf = node => node.openingElement.attributes.find(attribute => attribute.name.name === 'field').value.value
const literalOf = node => node.children[0].expression.value

test('a new JSX page gets editable copy and static images without authored wrappers', () => {
  const { ast, code } = transform(`export default function FuturePage() {
    return <main><h1>A future page</h1><p>{'Its introduction'}</p><img src="/future.jpg" alt="Campus" className="hero" ref={imageRef} onLoad={ready} /></main>
  }`)
  assert.deepEqual(editorNodes(ast).map(literalOf), ['A future page', 'Its introduction'])
  const [image] = editorNodes(ast, '_AutoEditableImage')
  assert.ok(image)
  assert.deepEqual(image.openingElement.attributes.map(attribute => attribute.name.name), ['src', 'alt', 'className', 'ref', 'onLoad', 'field'])
  assert.match(code, /from "@site-editor\/automatic"/)
  assert.match(fieldOf(image), /^auto\.[a-f0-9]{24}$/)
})

test('JSX whitespace remains equivalent across inline links and multiline content', () => {
  const { ast } = transform(`function Page() { return <p>
    Read our <a href="/privacy">privacy notice</a> for details.
    Thank you.
  </p> }`)
  assert.deepEqual(editorNodes(ast).map(literalOf), ['Read our ', 'privacy notice', ' for details. Thank you.'])
})

test('manual editors, editor infrastructure, attributes and sensitive dynamic values stay untouched', () => {
  const source = `import { EditableText as ExistingText } from './SiteEditor'
  function Page() { return <main>
    <ExistingText field="hero.title">Existing title</ExistingText>
    <EditableInlineImage field="image" fallback="/campus.jpg" />
    <Helmet><title>Metadata</title></Helmet><script>script text</script><style>style text</style>
    <pre>code example</pre><code>inline code</code><textarea>textarea value</textarea>
    <select><option>Form option</option></select><svg><text>SVG label</text></svg>
    <section data-editor-ignore><p>Private example</p><img src="/ignored.jpg" /></section>
    <p>{user.email}</p><p>{error}</p><p>{count}</p><img src={security.qrCode} />
    <input placeholder={t('placeholder')} value="Never wrap values" />
    <button aria-label={t('accessible.label')} title="Keep attributes" onClick={() => t('event')}>Visible action</button>
  </main> }`
  assert.deepEqual(editorNodes(transform(source).ast).map(literalOf), ['Visible action'])
  for (const filename of ['src/SiteEditor.jsx', 'src/AutomaticContent.jsx', 'src/editor-context.jsx', 'src/SiteEditorProvider.jsx', 'node_modules/library/src/Page.jsx']) {
    const result = transform('function Page() { return <p>Leave infrastructure alone</p> }', filename)
    assert.equal(editorNodes(result.ast).length, 0, filename)
    assert.doesNotMatch(result.code, /@site-editor\/automatic/)
  }
})

test('static translation keys are editable while interpolated and object-returning translations are not', () => {
  const { ast } = transform(`function Page() { return <main>
    <p>{t('marketing.heading')}</p><p>{pt('save', 'Save application')}</p>
    <p>{t('copy', { defaultValue: 'Fallback copy' })}</p>
    <p>{t('greeting', { name: user.name })}</p><p>{t(key)}</p>
    <p>{t('items', { returnObjects: true })}</p><p>{t('count', { count: 3 })}</p>
    <p>{t('description', { defaultValue: privateDescription })}</p>
  </main> }`)
  assert.deepEqual(editorNodes(ast).map(node => node.children[0].expression.arguments[0].value), ['marketing.heading', 'save', 'copy'])
})

test('literal conditional branches have independent fields without altering the condition', () => {
  const { ast, code } = transform(`function Page() { return <main>
    <button>{open ? 'Close menu' : 'Open menu'}</button>
    <p>{locale === 'ro' ? 'Bun venit' : 'Welcome'}</p>
    <p>{error ? error.message : 'Unchanged mixed expression'}</p>
  </main> }`)
  const nodes = editorNodes(ast)
  assert.deepEqual(nodes.map(literalOf), ['Close menu', 'Open menu', 'Bun venit', 'Welcome'])
  assert.equal(new Set(nodes.map(fieldOf)).size, 4)
  assert.match(code, /open \? <_AutoEditableText/)
  assert.match(code, /error \? error\.message : 'Unchanged mixed expression'/)
})

test('fields remain stable after unrelated insertion and differ between components or files', () => {
  const initial = transform('function Page() { return <h1>Keep my published content</h1> }')
  const changed = transform(`const unrelated = 'Inserted before the component';
    function Page() { return <main><p>New sibling</p><h1>Keep my published content</h1></main> }`)
  const initialField = fieldOf(editorNodes(initial.ast)[0])
  assert.equal(fieldOf(editorNodes(changed.ast).find(node => literalOf(node) === 'Keep my published content')), initialField)
  assert.notEqual(fieldOf(editorNodes(transform('function OtherPage() { return <h1>Keep my published content</h1> }').ast)[0]), initialField)
  assert.notEqual(fieldOf(editorNodes(transform('function Page() { return <h1>Keep my published content</h1> }', 'src/OtherFile.jsx').ast)[0]), initialField)
})

test('generated editable text is never instrumented again or converted into nested controls', () => {
  const source = 'function Page() { return <button>Hello <strong>world</strong>{t("action")}</button> }'
  const result = transform(source)
  const nodes = editorNodes(result.ast)
  assert.equal(nodes.length, 3)
  for (const node of nodes) assert.equal(editorNodes({ children: node.children }).length, 0)
  const repeated = transform(result.code)
  assert.equal(editorNodes(repeated.ast).length, 3)
  assert.equal((repeated.code.match(/@site-editor\/automatic/g) || []).length, 1)
})
