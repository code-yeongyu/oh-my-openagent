const METHODS = new Set([
  "equal", "strictEqual", "deepEqual", "deepStrictEqual",
  "notEqual", "notStrictEqual", "deepNotEqual", "deepNotStrictEqual",
  "match", "doesNotMatch", "ok",
])
const CONTEXT_NAME = /prompt|directive|instructions?|skill(?:content|text)?|markdown|systemmessage|agenttext|compatibility|guidance|codexharness/i

export function createNodeAssertContext(ts, source, helpers, bindings, loopBindings) {
  const { resolveNode, sourceText, unwrap } = helpers

  return function containsNodeAssertContext(node, seen = new Set()) {
    node = unwrap(node)
    if (!node) return false
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return false
      seen = new Set(seen)
      seen.add(node.text)
    }
    const resolved = resolveNode(node, bindings, loopBindings)
    if (CONTEXT_NAME.test(sourceText(source, resolved))) return true
    let found = false
    ts.forEachChild(resolved, (child) => {
      if (!found && containsNodeAssertContext(child, seen)) found = true
    })
    return found
  }
}

export function createNodeAssertShape(ts, source, helpers) {
  const { propertyName, sourceText, unwrap } = helpers
  const objects = new Set()
  const functions = new Map()

  function isAssertModule(node) {
    node = unwrap(node)
    if (!node) return false
    if (ts.isStringLiteralLike(node)) return node.text === "node:assert" || node.text === "node:assert/strict"
    return Boolean(
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "require"
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
      && isAssertModule(node.arguments[0]),
    )
  }

  function register(imported, local) {
    if (imported === "default" || imported === "strict") objects.add(local)
    else if (METHODS.has(imported)) functions.set(local, imported)
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && isAssertModule(statement.moduleSpecifier)) {
      const clause = statement.importClause
      if (!clause) continue
      if (clause.name) objects.add(clause.name.text)
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        objects.add(clause.namedBindings.name.text)
      } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          register((element.propertyName ?? element.name).text, element.name.text)
        }
      }
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const initializer = unwrap(declaration.initializer)
      if (!initializer) continue
      const isModule = isAssertModule(initializer)
      const isStrictModule = Boolean(
        ts.isPropertyAccessExpression(initializer)
        && initializer.name.text === "strict"
        && isAssertModule(initializer.expression),
      )
      if (ts.isIdentifier(declaration.name) && (isModule || isStrictModule)) {
        objects.add(declaration.name.text)
      } else if (ts.isObjectBindingPattern(declaration.name) && isModule) {
        for (const element of declaration.name.elements) {
          if (ts.isIdentifier(element.name)) {
            register(propertyName(element.propertyName ?? element.name), element.name.text)
          }
        }
      }
    }
  }

  return function nodeAssertShape(call) {
    if (!ts.isCallExpression(call)) return null
    if (ts.isIdentifier(call.expression) && objects.has(call.expression.text)) {
      return {
        matcher: call.expression.text,
        method: "ok",
        nodeAssert: true,
        actual: call.arguments[0],
        expected: undefined,
      }
    }
    if (ts.isIdentifier(call.expression) && functions.has(call.expression.text)) {
      const method = functions.get(call.expression.text)
      return {
        matcher: call.expression.text,
        method,
        nodeAssert: true,
        actual: call.arguments[0],
        expected: method === "ok" ? undefined : call.arguments[1],
      }
    }
    if (!ts.isPropertyAccessExpression(call.expression)) return null
    const parts = []
    let expression = call.expression
    while (ts.isPropertyAccessExpression(expression)) {
      parts.unshift(expression.name.text)
      expression = expression.expression
    }
    if (!ts.isIdentifier(expression) || !objects.has(expression.text)) return null
    const method = parts.at(-1)
    if (!METHODS.has(method)) return null
    if (parts.length > 1 && (parts.length !== 2 || parts[0] !== "strict")) return null
    return {
      matcher: sourceText(source, call.expression),
      method,
      nodeAssert: true,
      actual: call.arguments[0],
      expected: method === "ok" ? undefined : call.arguments[1],
    }
  }
}
