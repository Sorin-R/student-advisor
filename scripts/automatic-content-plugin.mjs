import { createHash } from 'node:crypto'
import path from 'node:path'

const excludedElements = new Set([
  'EditableText', 'EditableImage', 'EditableInlineImage', 'AutoEditableText', 'AutoEditableImage',
  'Helmet', 'script', 'style', 'code', 'pre', 'textarea', 'option', 'select', 'svg', 'math', 'title',
])
const excludedFiles = /(?:^|\/)(?:AutomaticContent|SiteEditor|editor-context|SiteEditorProvider)\.[cm]?[jt]sx?$/i

// Match React's JSX whitespace normalization before moving text into an expression.
// In particular, an inline trailing space before a link must remain a space.
export function jsxTextValue(value) {
  const lines = value.split(/\r\n|\n|\r/)
  let lastNonEmptyLine = 0
  lines.forEach((line, index) => { if (/[^ \t]/.test(line)) lastNonEmptyLine = index })
  return lines.map((line, index) => {
    let text = line.replace(/\t/g, ' ')
    if (index !== 0) text = text.replace(/^ +/, '')
    if (index !== lines.length - 1) text = text.replace(/ +$/, '')
    return text ? text + (index !== lastNonEmptyLine ? ' ' : '') : ''
  }).join('')
}

export function automaticContentField(filename, component, identity) {
  return `auto.${createHash('sha256').update(`${filename}\0${component}\0${identity}`).digest('hex').slice(0, 24)}`
}

function elementName(node) {
  if (node?.type === 'JSXIdentifier') return node.name
  if (node?.type === 'JSXMemberExpression') return elementName(node.property)
  return ''
}

function componentName(nodePath) {
  for (let current = nodePath; current; current = current.parentPath) {
    if (!current.isFunction()) continue
    if (current.node.id?.name) return current.node.id.name
    if (current.parentPath.isVariableDeclarator() && current.parentPath.node.id.type === 'Identifier') return current.parentPath.node.id.name
    if (current.parentPath.isObjectProperty() && current.parentPath.node.key.type === 'Identifier') return current.parentPath.node.key.name
  }
  return 'module'
}

export default function automaticContentPlugin({ types: t }) {
  const literalValue = node => t.isStringLiteral(node) ? node.value : t.isTemplateLiteral(node) && node.expressions.length === 0 ? node.quasis[0].value.cooked : null

  function excluded(nodePath, state) {
    if (!state.automaticContent.enabled) return true
    for (let current = nodePath; current; current = current.parentPath) {
      // Never turn input values, URLs, accessible names, event handlers or other props into React elements.
      if (current.isJSXAttribute()) return true
      if (!current.isJSXElement()) continue
      const opening = current.node.openingElement
      const name = elementName(opening.name)
      if (state.automaticContent.excluded.has(name)) return true
      if (opening.attributes.some(attribute => t.isJSXAttribute(attribute) && attribute.name.name === 'data-editor-ignore')) return true
    }
    return false
  }

  function textElement(expression, identity, nodePath, state) {
    const config = state.automaticContent
    config.textUsed = true
    const field = automaticContentField(config.filename, componentName(nodePath), identity)
    return t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier(config.textIdentifier.name), [t.jsxAttribute(t.jsxIdentifier('field'), t.stringLiteral(field))]),
      t.jsxClosingElement(t.jsxIdentifier(config.textIdentifier.name)),
      [t.jsxExpressionContainer(expression)],
    )
  }

  function translationIdentity(expression) {
    if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee) || !['t', 'pt'].includes(expression.callee.name)) return null
    const [key, options] = expression.arguments
    if (!t.isStringLiteral(key) || expression.arguments.length > 2) return null
    if (!options) return `translation:${expression.callee.name}:${key.value}`
    // Both i18next and the existing pt helper accept a literal default string.
    if (literalValue(options) !== null) return `translation:${expression.callee.name}:${key.value}`
    if (!t.isObjectExpression(options)) return null
    const settings = []
    for (const property of options.properties) {
      if (!t.isObjectProperty(property) || property.computed) return null
      const name = t.isIdentifier(property.key) ? property.key.name : property.key.value
      if (!['defaultValue', 'ns', 'keyPrefix'].includes(name) || literalValue(property.value) === null) return null
      if (name !== 'defaultValue') settings.push(`${name}:${literalValue(property.value)}`)
    }
    return `translation:${expression.callee.name}:${key.value}:${settings.sort().join('|')}`
  }

  function pureLiteralBranches(expression) {
    return literalValue(expression) !== null || t.isConditionalExpression(expression) && pureLiteralBranches(expression.consequent) && pureLiteralBranches(expression.alternate)
  }

  function editableBranches(expression, nodePath, state) {
    const value = literalValue(expression)
    if (value !== null) return value.trim() ? textElement(expression, `literal:${value}`, nodePath, state) : expression
    return t.conditionalExpression(expression.test, editableBranches(expression.consequent, nodePath, state), editableBranches(expression.alternate, nodePath, state))
  }

  return {
    name: 'automatic-website-content',
    visitor: {
      Program: {
        enter(programPath, state) {
          const filename = (state.filename || '').replaceAll('\\', '/')
          const relative = path.relative(state.opts.root || state.cwd, filename).replaceAll('\\', '/')
          const excludedNames = new Set(excludedElements)
          for (const statement of programPath.node.body) {
            if (!t.isImportDeclaration(statement)) continue
            for (const specifier of statement.specifiers) {
              if (t.isImportSpecifier(specifier) && excludedElements.has(specifier.imported.name)) excludedNames.add(specifier.local.name)
            }
          }
          const textIdentifier = programPath.scope.generateUidIdentifier('AutoEditableText')
          const imageIdentifier = programPath.scope.generateUidIdentifier('AutoEditableImage')
          excludedNames.add(textIdentifier.name)
          excludedNames.add(imageIdentifier.name)
          state.automaticContent = {
            enabled: /(?:^|\/)src\/.*\.[jt]sx?$/.test(relative) && !filename.includes('/node_modules/') && !excludedFiles.test(filename),
            filename: relative, excluded: excludedNames, textIdentifier, imageIdentifier, textUsed: false, imageUsed: false,
          }
        },
        exit(programPath, state) {
          const config = state.automaticContent
          const specifiers = []
          if (config.textUsed) specifiers.push(t.importSpecifier(config.textIdentifier, t.identifier('AutoEditableText')))
          if (config.imageUsed) specifiers.push(t.importSpecifier(config.imageIdentifier, t.identifier('AutoEditableImage')))
          if (specifiers.length) programPath.unshiftContainer('body', t.importDeclaration(specifiers, t.stringLiteral('@site-editor/automatic')))
        },
      },
      JSXText(nodePath, state) {
        if (excluded(nodePath, state)) return
        const value = jsxTextValue(nodePath.node.value)
        if (value.trim()) nodePath.replaceWith(textElement(t.stringLiteral(value), `literal:${value}`, nodePath, state))
      },
      JSXExpressionContainer(nodePath, state) {
        if (excluded(nodePath, state) || (!nodePath.parentPath.isJSXElement() && !nodePath.parentPath.isJSXFragment())) return
        const expression = nodePath.node.expression
        const value = literalValue(expression)
        if (value !== null && value.trim()) {
          nodePath.replaceWith(textElement(expression, `literal:${value}`, nodePath, state))
          return
        }
        const identity = translationIdentity(expression)
        if (identity) {
          nodePath.replaceWith(textElement(expression, identity, nodePath, state))
          return
        }
        if (t.isConditionalExpression(expression) && pureLiteralBranches(expression)) nodePath.get('expression').replaceWith(editableBranches(expression, nodePath, state))
      },
      JSXElement: {
        exit(nodePath, state) {
          if (excluded(nodePath, state)) return
          const opening = nodePath.node.openingElement
          if (!t.isJSXIdentifier(opening.name, { name: 'img' })) return
          const src = opening.attributes.find(attribute => t.isJSXAttribute(attribute) && attribute.name.name === 'src')
          const source = t.isJSXExpressionContainer(src?.value) ? literalValue(src.value.expression) : literalValue(src?.value)
          if (!source) return
          const config = state.automaticContent
          config.imageUsed = true
          const field = automaticContentField(config.filename, componentName(nodePath), `image:${source}`)
          opening.name = t.jsxIdentifier(config.imageIdentifier.name)
          opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('field'), t.stringLiteral(field)))
          if (nodePath.node.closingElement) nodePath.node.closingElement.name = t.jsxIdentifier(config.imageIdentifier.name)
        },
      },
    },
  }
}
