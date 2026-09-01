export function createAstHelpers(ts) {
  function scriptKind(file) {
    if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
    if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
    if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS
    return ts.ScriptKind.TS
  }

  function unwrap(node) {
    while (node && (
      ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node)
      || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node))
    )) node = node.expression
    return node
  }

  function propertyName(node) {
    if (!node) return ""
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
    return ""
  }

  function normalized(value) {
    return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim()
  }

  function literal(node) {
    node = unwrap(node)
    if (!node) return null
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isRegularExpressionLiteral(node)) return node.text
    return null
  }

  function sourceText(source, node) {
    return node ? normalized(node.getText(source)).slice(0, 300) : ""
  }

  function collectBindings(source) {
    const bindings = new Map()
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const entries = bindings.get(node.name.text) ?? []
        entries.push({ position: node.getStart(source), initializer: node.initializer })
        bindings.set(node.name.text, entries)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return bindings
  }

  function bindingFor(identifier, bindings) {
    const entries = bindings.get(identifier.text) ?? []
    const position = identifier.getStart()
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index].position <= position) return entries[index].initializer
    }
    return null
  }

  function resolveNode(node, bindings, loopBindings, seen = new Set()) {
    node = unwrap(node)
    if (!node || !ts.isIdentifier(node)) return node
    if (loopBindings.has(node.text)) return loopBindings.get(node.text)
    const binding = bindingFor(node, bindings)
    if (seen.has(node.text) || !binding) return node
    seen.add(node.text)
    return resolveNode(binding, bindings, loopBindings, seen)
  }

  function valuesFrom(node, bindings, loopBindings, seen = new Set()) {
    node = unwrap(node)
    if (!node) return []
    const direct = literal(node)
    if (direct !== null) return [{ value: direct, node }]
    if (ts.isIdentifier(node)) {
      if (loopBindings.has(node.text)) return valuesFrom(loopBindings.get(node.text), bindings, loopBindings, seen)
      const binding = bindingFor(node, bindings)
      if (seen.has(node.text) || !binding) return []
      const next = new Set(seen)
      next.add(node.text)
      return valuesFrom(binding, bindings, loopBindings, next)
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.flatMap((element) => valuesFrom(element, bindings, loopBindings, seen))
    }
    if (ts.isConditionalExpression(node)) {
      return [
        ...valuesFrom(node.whenTrue, bindings, loopBindings, seen),
        ...valuesFrom(node.whenFalse, bindings, loopBindings, seen),
      ]
    }
    return []
  }

  return {
    bindingFor,
    collectBindings,
    normalized,
    propertyName,
    resolveNode,
    scriptKind,
    sourceText,
    unwrap,
    valuesFrom,
  }
}
