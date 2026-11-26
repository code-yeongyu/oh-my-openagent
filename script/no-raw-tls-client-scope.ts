import ts from "@typescript/typescript6"

// Lexical scopes for the TLS guard's name bindings (#15071), modelled on JavaScript's own rules and leaning toward a
// hit wherever a rule is uncertain:
// - a var or parameter is one binding per function (the body block and the function are one scope), so any client
//   alias among a function's declarations of a name makes that name the client throughout the function;
// - a parameter of a function that mentions `arguments` never shadows, since a write through it rebinds the parameter;
// - a computed member name or a decorator is resolved outside the member it belongs to;
// - a file with a with statement or a direct eval has no resolvable scope: every reference there resolves by name
//   alone, as before #15071.
// A parameter default is read like a variable initializer by the caller (no-raw-tls-client.ts); flow through a plain
// assignment or an immediately invoked function's argument is tracked through flowTargets and declare/assign. Other
// data flow is out of scope for this guard.

type Declaration = { readonly name: ts.Identifier; readonly scope: ts.Node; readonly shadows: boolean }

function isFunctionScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node)
  )
}

function isScope(node: ts.Node): boolean {
  return (
    isFunctionScope(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isClassLike(node)
  )
}

function asScope(node: ts.Node): ts.Node {
  return ts.isBlock(node) && !ts.isSourceFile(node.parent) && isFunctionScope(node.parent) ? node.parent : node
}

function enclosing(node: ts.Node, test: (candidate: ts.Node) => boolean): ts.Node {
  let current = node.parent
  while (!test(current)) current = current.parent
  return asScope(current)
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name]
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []))
}

function mentionsArguments(fn: ts.Node): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === "arguments") found = true
    else ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn, visit)
  return found
}

function declarationsOf(node: ts.Node, argumentsUsers: Set<ts.Node>): Declaration[] {
  const at = (names: ts.Identifier[], scope: ts.Node, shadows = true): Declaration[] =>
    names.map((name) => ({ name, scope, shadows }))
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
    const blockScoped = (node.parent.flags & ts.NodeFlags.BlockScoped) !== 0
    return at(bindingNames(node.name), enclosing(node.parent, blockScoped ? isScope : isFunctionScope))
  }
  if (ts.isParameter(node)) return at(bindingNames(node.name), node.parent, !argumentsUsers.has(node.parent))
  if (ts.isCatchClause(node) && node.variableDeclaration) return at(bindingNames(node.variableDeclaration.name), node)
  if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) return at([node.name], node)
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name)
    return ts.isIdentifier(node.name) ? at([node.name], enclosing(node, isScope)) : []
  if (ts.isImportClause(node) && node.name) return at([node.name], node.getSourceFile())
  if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node) || ts.isImportEqualsDeclaration(node))
    return at([node.name], node.getSourceFile())
  return []
}

function isDirectEval(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  let callee: ts.Expression = node.expression
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression
  return ts.isIdentifier(callee) && callee.text === "eval"
}

function evaluatedOutside(node: ts.Node): ts.Node | undefined {
  if (ts.isComputedPropertyName(node)) return node.parent
  if (ts.isDecorator(node)) return ts.isParameter(node.parent) ? node.parent.parent : node.parent
  return undefined
}

type Flow = readonly [name: ts.Identifier, value: ts.Expression, how: "declare" | "assign"]

export function flowTargets(node: ts.Node): Flow[] {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    let left: ts.Expression = node.left
    while (ts.isParenthesizedExpression(left)) left = left.expression
    return ts.isIdentifier(left) ? [[left, node.right, "assign"]] : []
  }
  if (ts.isCallExpression(node)) {
    let callee: ts.Expression = node.expression
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression
    if (!ts.isFunctionExpression(callee) && !ts.isArrowFunction(callee)) return []
    return callee.parameters.flatMap((parameter, position): Flow[] => {
      const argument = node.arguments[position]
      return argument && ts.isIdentifier(parameter.name) ? [[parameter.name, argument, "declare"]] : []
    })
  }
  return []
}

type BindingScopes<T> = {
  readonly declare: (name: ts.Identifier, value: T) => boolean
  readonly assign: (reference: ts.Identifier, value: T) => boolean
  readonly resolve: (reference: ts.Identifier) => T | undefined
  readonly globalProperty: (name: string) => T | undefined
}

export function createBindingScopes<T>(nodes: readonly ts.Node[], globals: ReadonlyMap<string, T>): BindingScopes<T> {
  const tracked = new Map<ts.Identifier, T>()
  const implicitGlobals = new Map<string, T>()
  const byScope = new Map<ts.Node, Map<string, Declaration[]>>()
  const byText = new Map<string, Declaration[]>()
  const argumentsUsers = new Set(nodes.filter((node) => isFunctionScope(node) && mentionsArguments(node)))
  const index = <K>(map: Map<K, Declaration[]>, key: K, declaration: Declaration): void => {
    const list = map.get(key)
    if (list) list.push(declaration)
    else map.set(key, [declaration])
  }
  for (const declaration of nodes.flatMap((node) => declarationsOf(node, argumentsUsers))) {
    index(byText, declaration.name.text, declaration)
    const names = byScope.get(declaration.scope) ?? new Map<string, Declaration[]>()
    byScope.set(declaration.scope, names)
    index(names, declaration.name.text, declaration)
  }
  const global = (name: string): T | undefined => implicitGlobals.get(name) ?? globals.get(name)
  const unresolvable = nodes.some((node) => ts.isWithStatement(node) || isDirectEval(node))
  const chains = new Map<ts.Identifier, Declaration[][]>()
  const chainOf = (reference: ts.Identifier): Declaration[][] => {
    const cached = chains.get(reference)
    if (cached) return cached
    const chain: Declaration[][] = []
    const skipped = new Set<ts.Node>()
    for (let previous: ts.Node = reference, scope = reference.parent; scope; previous = scope, scope = scope.parent) {
      const outside = evaluatedOutside(previous)
      if (outside) skipped.add(outside)
      const declarations = skipped.has(scope) ? undefined : byScope.get(scope)?.get(reference.text)
      if (declarations) chain.push(declarations)
    }
    chains.set(reference, chain)
    return chain
  }
  const firstMatch = (reference: ts.Identifier): Declaration[] | undefined =>
    chainOf(reference).find(
      (declarations) =>
        declarations.some((declaration) => declaration.shadows) ||
        declarations.some((declaration) => tracked.has(declaration.name)),
    )
  const trackedIn = (declarations: readonly Declaration[]): T | undefined =>
    declarations.map((declaration) => tracked.get(declaration.name)).find((value) => value !== undefined)
  const byName = (name: string): T | undefined => trackedIn(byText.get(name) ?? []) ?? global(name)
  const declare = (name: ts.Identifier, value: T): boolean => {
    if (tracked.has(name)) return false
    tracked.set(name, value)
    return true
  }
  return {
    declare,
    assign: (reference, value) => {
      const declarations = unresolvable ? byText.get(reference.text) : firstMatch(reference)
      const target = declarations?.[0]
      if (target) return declare(target.name, value)
      if (implicitGlobals.has(reference.text)) return false
      implicitGlobals.set(reference.text, value)
      return true
    },
    resolve: (reference) => {
      if (unresolvable) return byName(reference.text)
      const declarations = firstMatch(reference)
      return declarations ? trackedIn(declarations) : global(reference.text)
    },
    globalProperty: (name) => {
      const sourceFile = nodes.find(ts.isSourceFile)
      const topLevel = sourceFile ? byScope.get(sourceFile)?.get(name) : undefined
      return trackedIn(topLevel ?? []) ?? global(name)
    },
  }
}
