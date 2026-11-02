import ts from "@typescript/typescript6"
import { posix } from "node:path"

import { TELEMETRY_OPT_OUT_NAMES } from "./telemetry-opt-out-env.mjs"

// Answers one question for telemetry-opt-out-env.scan.mjs: does this expression's value come from an
// actual CALL of an opt-out helper? Identifiers are resolved by lexical scope (locals, parameters
// through every call site of their function, imports of relative modules), so a helper named in a
// comment, imported but unused, or merely in scope elsewhere in the file never counts.

const HELPERS = new Set(["withTelemetryOptOut", "telemetryLocalSinkEnv", "isolatedChildEnv"])
const OPT_OUT = new Set(TELEMETRY_OPT_OUT_NAMES)
// Values telemetry-core `shouldDisableTelemetry` reads as opted out, per opt-out name.
const keepsOff = (name, text) => {
  const value = text.trim().toLowerCase()
  return name.endsWith("_SEND_ANONYMOUS_TELEMETRY") ? ["0", "false", "no", "yes"].includes(value) : ["1", "true", "yes"].includes(value)
}
const MAX_DEPTH = 24

export const unwrap = (node) => {
  let current = node
  while (current !== undefined && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current) || ts.isAwaitExpression(current) || ts.isNonNullExpression(current))) {
    current = current.expression
  }
  return current
}

const isFunction = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)

function functionNameOf(fn) {
  if (fn.name !== undefined && ts.isIdentifier(fn.name)) return fn.name.text
  const parent = fn.parent
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : undefined
}

function bindingIn(statements, name, scope) {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { kind: "function", node: statement }
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      const element = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.find((e) => e.name.text === name) : undefined
      if (element !== undefined) return { kind: "import", node: statement, imported: (element.propertyName ?? element.name).text }
    }
    const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : []
    for (const declaration of declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { kind: "value", node: declaration, scope }
      if (ts.isObjectBindingPattern(declaration.name)) {
        const element = declaration.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === name)
        if (element !== undefined) return { kind: "member", node: declaration, member: (element.propertyName ?? element.name).getText(), name, scope }
      }
    }
  }
  return undefined
}

function parameterBinding(fn, name) {
  for (const [index, parameter] of fn.parameters.entries()) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return { kind: "param", node: fn, index, name }
    if (ts.isObjectBindingPattern(parameter.name)) {
      const element = parameter.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === name)
      if (element !== undefined) return { kind: "param", node: fn, index, name, member: (element.propertyName ?? element.name).getText() }
    }
  }
  return undefined
}

function bindingOf(identifier) {
  const name = identifier.text
  for (let scope = identifier.parent; scope !== undefined; scope = scope.parent) {
    if (isFunction(scope)) {
      const parameter = parameterBinding(scope, name)
      if (parameter !== undefined) return parameter
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope)) {
      const found = bindingIn(scope.statements, name, scope)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function assignmentsTo(scope, name) {
  const values = []
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left) && node.left.text === name) values.push(node.right)
    ts.forEachChild(node, visit)
  }
  if (scope !== undefined) visit(scope)
  return values
}

const isDynamicImport = (node) => node !== undefined && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword

function callsNamed(file, name) {
  const calls = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return calls
}

function returnsOf(fn) {
  if (fn.body === undefined) return []
  if (!ts.isBlock(fn.body)) return [fn.body]
  const found = []
  const visit = (node) => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression)
    if (!isFunction(node)) ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return found
}

export function createTracer(parseFile, paths) {
  const every = (nodes, test) => nodes.length > 0 && nodes.every(test)

  const moduleAt = (file, specifier) => {
    const target = posix.normalize(posix.join(posix.dirname(file.fileName), specifier))
    return [target, target.replace(/\.js$/u, ".ts")].map(parseFile).find((f) => f !== undefined)
  }

  const imported = (binding) => {
    const resolved = moduleAt(binding.node.getSourceFile(), binding.node.moduleSpecifier.text)
    return resolved === undefined ? undefined : bindingIn(resolved.statements, binding.imported, resolved)
  }

  const dynamicMember = (binding) => {
    const init = unwrap(binding.node.initializer)
    const specifier = isDynamicImport(init) ? init.arguments[0] : undefined
    if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return undefined
    const resolved = moduleAt(binding.node.getSourceFile(), specifier.text)
    return resolved === undefined ? undefined : bindingIn(resolved.statements, binding.member, resolved)
  }

  const callersOf = (fn) => {
    const name = functionNameOf(fn)
    if (name === undefined) return []
    const home = fn.getSourceFile()
    const calls = [...callsNamed(home, name)]
    for (const path of paths) {
      const file = parseFile(path)
      if (file === undefined || file === home) continue
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) || moduleAt(file, statement.moduleSpecifier.text) !== home) continue
        const bindings = statement.importClause?.namedBindings
        if (bindings === undefined || !ts.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === name) calls.push(...callsNamed(file, element.name.text))
        }
      }
    }
    return calls
  }

  const callableReaches = (binding, member, depth) => {
    if (binding === undefined || depth > MAX_DEPTH) return false
    if (binding.kind === "import") return HELPERS.has(binding.imported) && member === undefined || callableReaches(imported(binding), member, depth + 1)
    if (binding.kind === "member" && isDynamicImport(unwrap(binding.node.initializer))) {
      return HELPERS.has(binding.member) && member === undefined || callableReaches(dynamicMember(binding), member, depth + 1)
    }
    const fn = binding.kind === "function" ? binding.node : unwrap(binding.kind === "value" ? binding.node.initializer : undefined)
    if (fn === undefined || !isFunction(fn)) return false
    return every(returnsOf(fn), (r) => member === undefined ? reaches(r, depth + 1) : memberReaches(r, member, depth + 1))
  }

  const bindingReaches = (binding, member, depth) => {
    if (binding === undefined || depth > MAX_DEPTH) return false
    if (binding.kind === "import") return bindingReaches(imported(binding), member, depth + 1)
    if (binding.kind === "value") {
      const init = binding.node.initializer
      const sources = [...(init === undefined ? [] : [init]), ...assignmentsTo(binding.scope, binding.node.name.text)]
      if (member === undefined && mutatesOptOut(binding.scope, binding.node.name.text)) return false
      return every(sources, (source) => member === undefined ? reaches(source, depth + 1) : memberReaches(source, member, depth + 1))
    }
    if (binding.kind === "member") {
      const init = binding.node.initializer
      if (member === undefined && mutatesOptOut(binding.scope, binding.name)) return false
      return init !== undefined && memberReaches(init, binding.member, depth + 1)
    }
    if (binding.kind === "param") {
      const path = binding.member === undefined ? member : binding.member
      if (path === undefined && mutatesOptOut(binding.node.body, binding.name)) return false
      return every(callersOf(binding.node), (call) => {
        const argument = call.arguments[binding.index]
        if (argument === undefined) return false
        if (binding.member !== undefined) return memberReaches(argument, binding.member, depth + 1)
        return path === undefined ? reaches(argument, depth + 1) : memberReaches(argument, path, depth + 1)
      })
    }
    return false
  }

  const memberReaches = (node, member, depth) => {
    const value = unwrap(node)
    if (value === undefined || depth > MAX_DEPTH) return false
    if (ts.isObjectLiteralExpression(value)) {
      const property = value.properties.findLast((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === member)
      if (property !== undefined) return reaches(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, depth + 1)
      return value.properties.some((p) => ts.isSpreadAssignment(p) && memberReaches(p.expression, member, depth + 1))
    }
    if (ts.isIdentifier(value)) return bindingReaches(bindingOf(value), member, depth + 1)
    if (ts.isCallExpression(value) && ts.isIdentifier(unwrap(value.expression))) {
      return callableReaches(bindingOf(unwrap(value.expression)), member, depth + 1)
    }
    return false
  }

  const reaches = (node, depth = 0) => {
    const value = unwrap(node)
    if (value === undefined || depth > MAX_DEPTH) return false
    if (ts.isCallExpression(value)) {
      const callee = unwrap(value.expression)
      if (!ts.isIdentifier(callee)) return false
      const binding = bindingOf(callee)
      return binding === undefined ? false : callableReaches(binding, undefined, depth + 1)
    }
    if (ts.isIdentifier(value)) return bindingReaches(bindingOf(value), undefined, depth + 1)
    if (ts.isPropertyAccessExpression(value)) return memberReaches(value.expression, value.name.text, depth + 1)
    if (ts.isObjectLiteralExpression(value)) {
      // The LAST routed spread decides; anything after it may override an opt-out again.
      const properties = value.properties
      const routed = properties.findLastIndex((p) => ts.isSpreadAssignment(p) && reaches(p.expression, depth + 1))
      if (routed === -1) return false
      return properties.slice(routed + 1).every((p) => ts.isSpreadAssignment(p) ? keepsOptOut(p.expression, depth + 1) : !propertyReenables(p))
    }
    if (ts.isConditionalExpression(value)) return reaches(value.whenTrue, depth + 1) && reaches(value.whenFalse, depth + 1)
    if (ts.isBinaryExpression(value) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(value.operatorToken.kind)) {
      return reaches(value.left, depth + 1) && reaches(value.right, depth + 1)
    }
    return false
  }

  // The opt-out half: once a helper produced the env, nothing after it may turn an opt-out back off.

  const isConst = (declaration) => (declaration.parent.flags & ts.NodeFlags.Const) !== 0

  const forOfOver = (identifier) => {
    for (let node = identifier.parent; node !== undefined; node = node.parent) {
      if (!ts.isForOfStatement(node) || !ts.isVariableDeclarationList(node.initializer)) continue
      if (node.initializer.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === identifier.text)) return node.expression
    }
    return undefined
  }

  /** Every string a key expression can take, or undefined when the scan cannot enumerate them. */
  const stringValues = (node, depth = 0) => {
    const value = unwrap(node)
    if (value === undefined || depth > MAX_DEPTH) return undefined
    if (ts.isStringLiteralLike(value)) return [value.text]
    if (ts.isArrayLiteralExpression(value)) {
      const parts = value.elements.map((element) => stringValues(element, depth + 1))
      return parts.every((part) => part !== undefined) ? parts.flat() : undefined
    }
    if (!ts.isIdentifier(value)) return undefined
    const iterable = forOfOver(value)
    if (iterable !== undefined) return stringValues(iterable, depth + 1)
    let binding = bindingOf(value)
    if (binding?.kind === "import") binding = imported(binding)
    if (binding?.kind !== "value" || !isConst(binding.node) || binding.node.initializer === undefined) return undefined
    return stringValues(binding.node.initializer, depth + 1)
  }

  /** Whether writing `written` (a node, or undefined for a delete) under these key names can re-enable telemetry. */
  const reenables = (names, written) => {
    if (names === undefined) return true
    const literal = written === undefined ? undefined : unwrap(written)
    return names.some((name) => OPT_OUT.has(name)
      && !(literal !== undefined && ts.isStringLiteralLike(literal) && keepsOff(name, literal.text)))
  }

  const propertyNames = (name) => ts.isComputedPropertyName(name) ? stringValues(name.expression)
    : ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? [name.text] : undefined

  const propertyReenables = (property) => {
    if (ts.isShorthandPropertyAssignment(property)) return reenables([property.name.text], property.name)
    if (ts.isPropertyAssignment(property)) return reenables(propertyNames(property.name), property.initializer)
    return !ts.isSpreadAssignment(property)
  }

  /** True when spreading or merging this value cannot turn an opt-out back off. */
  const keepsOptOut = (node, depth) => {
    const value = unwrap(node)
    if (value === undefined || depth > MAX_DEPTH) return false
    if (ts.isObjectLiteralExpression(value)) {
      return value.properties.every((p) => ts.isSpreadAssignment(p) ? keepsOptOut(p.expression, depth + 1) : !propertyReenables(p))
    }
    if (ts.isConditionalExpression(value)) return keepsOptOut(value.whenTrue, depth + 1) && keepsOptOut(value.whenFalse, depth + 1)
    if (ts.isBinaryExpression(value) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(value.operatorToken.kind)) {
      return keepsOptOut(value.left, depth + 1) && keepsOptOut(value.right, depth + 1)
    }
    if (value.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(value) && value.text === "undefined") return true
    // A helper result: withTelemetryOptOut keeps every opt-out, telemetryLocalSinkEnv opts in toward loopback only.
    if (reaches(value, depth + 1)) return true
    if (ts.isCallExpression(value) && ts.isIdentifier(unwrap(value.expression))) {
      const fn = functionOf(bindingOf(unwrap(value.expression)), depth + 1)
      return fn !== undefined && every(returnsOf(fn), (returned) => keepsOptOut(returned, depth + 1))
    }
    if (ts.isIdentifier(value)) return bindingKeeps(bindingOf(value), undefined, depth + 1)
    if (ts.isPropertyAccessExpression(value)) return memberKeeps(value.expression, value.name.text, depth + 1)
    return false
  }

  const functionOf = (binding, depth) => {
    if (binding === undefined || depth > MAX_DEPTH) return undefined
    if (binding.kind === "import") return functionOf(imported(binding), depth + 1)
    if (binding.kind === "function") return binding.node
    const init = binding.kind === "value" ? unwrap(binding.node.initializer) : undefined
    return init !== undefined && isFunction(init) ? init : undefined
  }

  const memberKeeps = (node, member, depth) => {
    const value = unwrap(node)
    if (value === undefined || depth > MAX_DEPTH) return false
    if (ts.isObjectLiteralExpression(value)) {
      return value.properties.every((p) => {
        if (ts.isSpreadAssignment(p)) return memberKeeps(p.expression, member, depth + 1)
        if (!(ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) || p.name.getText() !== member) return true
        return keepsOptOut(ts.isShorthandPropertyAssignment(p) ? p.name : p.initializer, depth + 1)
      })
    }
    if (ts.isIdentifier(value)) return bindingKeeps(bindingOf(value), member, depth + 1)
    return false
  }

  const parameterDefault = (binding) => {
    const parameter = binding.node.parameters[binding.index]
    if (binding.member === undefined) return parameter.initializer
    const element = ts.isObjectBindingPattern(parameter.name)
      ? parameter.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === binding.name)
      : undefined
    return element?.initializer
  }

  const bindingKeeps = (binding, member, depth) => {
    if (binding === undefined || depth > MAX_DEPTH) return false
    if (binding.kind === "import") return bindingKeeps(imported(binding), member, depth + 1)
    const keeps = (node) => member === undefined ? keepsOptOut(node, depth + 1) : memberKeeps(node, member, depth + 1)
    if (binding.kind === "value") {
      const init = binding.node.initializer
      const sources = [...(init === undefined ? [] : [init]), ...assignmentsTo(binding.scope, binding.node.name.text)]
      return every(sources, keeps) && (member !== undefined || !mutatesOptOut(binding.scope, binding.node.name.text))
    }
    if (binding.kind === "member") {
      return binding.node.initializer !== undefined && memberKeeps(binding.node.initializer, binding.member, depth + 1)
    }
    if (binding.kind === "param") {
      if (member !== undefined && binding.member !== undefined) return false
      const fallback = parameterDefault(binding)
      if (fallback !== undefined && !keeps(fallback)) return false
      return every(callersOf(binding.node), (call) => {
        const argument = call.arguments[binding.index]
        if (argument === undefined) return true
        if (binding.member !== undefined) return memberKeeps(argument, binding.member, depth + 1)
        return keeps(argument)
      })
    }
    return false
  }

  /** True when code in `scope` can turn an opt-out of the env bound to `name` back off after the helper ran. */
  const mutatesOptOut = (scope, name) => {
    if (scope === undefined || name === undefined) return false
    const onName = (node) => {
      const target = unwrap(node)
      return target !== undefined && ts.isIdentifier(target) && target.text === name
    }
    const keysOf = (node) => {
      const target = unwrap(node)
      if (target === undefined) return null
      if (ts.isPropertyAccessExpression(target) && onName(target.expression)) return [target.name.text]
      if (ts.isElementAccessExpression(target) && onName(target.expression)) return stringValues(target.argumentExpression)
      return null
    }
    let found = false
    const visit = (node) => {
      if (found) return
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const keys = keysOf(node.left)
        const plain = node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        if (keys !== null && reenables(keys, plain ? node.right : undefined)) found = true
      } else if (ts.isDeleteExpression(node)) {
        const keys = keysOf(node.expression)
        if (keys !== null && reenables(keys, undefined)) found = true
      } else if (ts.isCallExpression(node) && node.expression.getText() === "Object.assign" && onName(node.arguments[0])
        && node.arguments.slice(1).some((argument) => !keepsOptOut(argument, 0))) {
        found = true
      }
      if (!found) ts.forEachChild(node, visit)
    }
    visit(scope)
    return found
  }

  return { reaches, memberReaches }
}
