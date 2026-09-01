export function createDerivedScanner(ts, helpers, source, bindings, loopBindings, add, instructionContext) {
  const { bindingFor, resolveNode, sourceText, unwrap, valuesFrom } = helpers

  function resolvedChildren(node, visit, seen = new Set()) {
    node = unwrap(node)
    if (!node) return
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return
      const target = loopBindings.get(node.text) ?? bindingFor(node, bindings)
      if (target) {
        const next = new Set(seen)
        next.add(node.text)
        visit(target, next)
      }
      return
    }
    ts.forEachChild(node, (child) => visit(child, seen))
  }

  function derivedContext(node) {
    let found = instructionContext(node)
    function visit(current, seen = new Set()) {
      current = unwrap(current)
      if (!current || found) return
      if (/\b(?:markdown|body|description|headings?|sections?|persona)\b/i.test(sourceText(source, current))) {
        found = true
        return
      }
      resolvedChildren(current, visit, seen)
    }
    visit(node)
    return found
  }

  function treeTextMatches(node, pattern) {
    let found = false
    function visit(current, seen = new Set()) {
      current = unwrap(current)
      if (!current || found) return
      if (pattern.test(sourceText(source, current))) {
        found = true
        return
      }
      resolvedChildren(current, visit, seen)
    }
    visit(node)
    return found
  }

  function callName(node) {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return ""
    return node.expression.name.text
  }

  function findCalls(node, names, found, seen = new Set()) {
    node = unwrap(node)
    if (!node) return
    if (ts.isCallExpression(node) && names.has(callName(node))) found(node)
    resolvedChildren(node, (child, nextSeen) => findCalls(child, names, found, nextSeen), seen)
  }

  function looksAuthored(value) {
    return /\s|`|^#{1,6}\s|^<[^>]+>|^---$/.test(value)
  }

  function addStartsWith(assertion, actual, matcher) {
    findCalls(actual, new Set(["startsWith"]), (call) => {
      const haystack = call.expression.expression
      const context = derivedContext(haystack)
      for (const value of valuesFrom(call.arguments[0], bindings, loopBindings)) {
        if (looksAuthored(value.value)) {
          add(assertion, "starts-with", `startsWith:${matcher}`, haystack, value.value, context, value.node)
        }
      }
    })
  }

  function mapSourceValues(call) {
    if (callName(call) !== "map") return []
    const callback = call.arguments[0]
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return []
    const parameter = callback.parameters[0]?.name
    if (!parameter || !ts.isIdentifier(parameter)) return []
    let indexesParameter = false
    findCalls(callback.body, new Set(["indexOf"]), (indexCall) => {
      const argument = unwrap(indexCall.arguments[0])
      if (argument && ts.isIdentifier(argument) && argument.text === parameter.text) indexesParameter = true
    })
    if (!indexesParameter) return []
    return valuesFrom(call.expression.expression, bindings, loopBindings)
  }

  function addRelativeOrder(assertion, actual, matcher) {
    findCalls(actual, new Set(["indexOf", "map"]), (call) => {
      if (callName(call) === "indexOf") {
        const haystack = call.expression.expression
        const context = derivedContext(haystack)
        for (const value of valuesFrom(call.arguments[0], bindings, loopBindings)) {
          add(assertion, "relative-order", `indexOf:${matcher}`, haystack, value.value, context, value.node)
        }
        return
      }
      const haystack = call.expression.expression
      const context = derivedContext(call)
      for (const value of mapSourceValues(call)) {
        add(assertion, "relative-order", `indexOf-map:${matcher}`, haystack, value.value, context, value.node)
      }
    })
  }

  function addDerivedArray(assertion, actual, expected, matcher) {
    if (!/^(?:toEqual|toStrictEqual)$/.test(matcher) || !derivedContext(actual)) return
    const resolved = resolveNode(actual, bindings, loopBindings)
    if (!/\.heading\b|\.matchAll\s*\(/.test(sourceText(source, resolved))) return
    for (const value of valuesFrom(expected, bindings, loopBindings)) {
      add(assertion, "derived-array-equality", matcher, actual, value.value, true, value.node)
    }
  }

  function addPresentationRegex(assertion, actual, matcher) {
    const resolved = resolveNode(actual, bindings, loopBindings)
    if (!treeTextMatches(resolved, /\.(?:matchAll|match|filter)\s*\(/)) return
    let context = derivedContext(resolved)
    const regexes = []
    function visit(node, seen = new Set()) {
      node = unwrap(node)
      if (!node) return
      context ||= derivedContext(node)
      if (ts.isRegularExpressionLiteral(node)) {
        regexes.push(node)
        return
      }
      resolvedChildren(node, visit, seen)
    }
    visit(resolved)
    for (const regex of regexes) {
      add(assertion, "presentation-regex", matcher, actual, regex.text, context, regex)
    }
  }

  function isNonEmptyAssertion(actual, expected, matcher) {
    if (!/^toBeGreaterThan(?:OrEqual)?$/.test(matcher)) return false
    const expectedText = sourceText(source, expected)
    if (expectedText !== "0") return false
    const resolved = resolveNode(actual, bindings, loopBindings)
    return /(?:\.length\b|\.size\b)/.test(sourceText(source, resolved))
  }

  function addNonEmpty(assertion, actual, expected, matcher) {
    if (!isNonEmptyAssertion(actual, expected, matcher) || !derivedContext(actual)) return
    add(
      assertion,
      "authored-non-empty",
      matcher,
      actual,
      "<non-empty authored text>",
      true,
      actual,
    )
  }

  return function scanDerived(assertion, shape) {
    if (shape.expected) addDerivedArray(assertion, shape.actual, shape.expected, shape.matcher)
    addStartsWith(assertion, shape.actual, shape.matcher)
    if (/^toBeGreaterThan(?:OrEqual)?$/.test(shape.matcher)) {
      addRelativeOrder(assertion, shape.actual, shape.matcher)
    }
    addPresentationRegex(assertion, shape.actual, shape.matcher)
    if (shape.expected) addNonEmpty(assertion, shape.actual, shape.expected, shape.matcher)
  }
}
