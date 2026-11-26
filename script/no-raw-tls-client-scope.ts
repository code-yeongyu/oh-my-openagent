import ts from "@typescript/typescript6"

// Lexical scopes for the TLS guard's name bindings (#15071). Resolution leans toward a hit whenever JavaScript's own
// rule is uncertain: a declaration that SHADOWS a name is placed in its narrowest syntactic scope, while a declaration
// that ALIASES a client is placed in its widest (a var hoists to its function). A file with a with statement or a direct
// eval has no resolvable scope, and every reference there resolves by name alone, as before #15071.

type Declaration = { readonly name: ts.Identifier; readonly narrow: ts.Node; readonly wide: ts.Node }

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

function enclosing(node: ts.Node, test: (candidate: ts.Node) => boolean): ts.Node {
  let current = node.parent
  while (!test(current)) current = current.parent
  return current
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name]
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []))
}

function declarationsOf(node: ts.Node): Declaration[] {
  const at = (names: ts.Identifier[], narrow: ts.Node, wide: ts.Node = narrow): Declaration[] =>
    names.map((name) => ({ name, narrow, wide }))
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
    const blockScoped = (node.parent.flags & ts.NodeFlags.BlockScoped) !== 0
    const narrow = enclosing(node.parent, isScope)
    return at(bindingNames(node.name), narrow, blockScoped ? narrow : enclosing(node.parent, isFunctionScope))
  }
  if (ts.isParameter(node)) return at(bindingNames(node.name), node.parent)
  if (ts.isCatchClause(node) && node.variableDeclaration) return at(bindingNames(node.variableDeclaration.name), node)
  if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) return at([node.name], node)
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name)
    return ts.isIdentifier(node.name) ? at([node.name], enclosing(node, isScope)) : []
  if (ts.isImportClause(node) && node.name) return at([node.name], node.getSourceFile())
  if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node) || ts.isImportEqualsDeclaration(node))
    return at([node.name], node.getSourceFile())
  return []
}

function hasUnresolvableScope(nodes: readonly ts.Node[]): boolean {
  return nodes.some(
    (node) =>
      ts.isWithStatement(node) ||
      (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval"),
  )
}

type BindingScopes<T> = {
  readonly declare: (name: ts.Identifier, value: T) => boolean
  readonly resolve: (reference: ts.Identifier) => T | undefined
}

export function createBindingScopes<T>(nodes: readonly ts.Node[], globals: ReadonlyMap<string, T>): BindingScopes<T> {
  const tracked = new Map<ts.Identifier, T>()
  const byScope = new Map<ts.Node, Map<string, Declaration[]>>()
  const byText = new Map<string, Declaration[]>()
  const index = <K>(map: Map<K, Declaration[]>, key: K, declaration: Declaration): void => {
    const list = map.get(key)
    if (list) list.push(declaration)
    else map.set(key, [declaration])
  }
  for (const declaration of nodes.flatMap(declarationsOf)) {
    index(byText, declaration.name.text, declaration)
    for (const scope of new Set([declaration.narrow, declaration.wide])) {
      const names = byScope.get(scope) ?? new Map<string, Declaration[]>()
      byScope.set(scope, names)
      index(names, declaration.name.text, declaration)
    }
  }
  const byName = (name: string): T | undefined => {
    for (const declaration of byText.get(name) ?? []) {
      const value = tracked.get(declaration.name)
      if (value !== undefined) return value
    }
    return globals.get(name)
  }
  const visible = (declaration: Declaration, scope: ts.Node): boolean =>
    declaration.narrow === scope || (declaration.wide === scope && tracked.has(declaration.name))
  const chains = new Map<ts.Identifier, ReadonlyArray<readonly [ts.Node, Declaration[]]>>()
  const chainOf = (reference: ts.Identifier): ReadonlyArray<readonly [ts.Node, Declaration[]]> => {
    const cached = chains.get(reference)
    if (cached) return cached
    const chain: Array<readonly [ts.Node, Declaration[]]> = []
    for (let scope: ts.Node | undefined = reference.parent; scope; scope = scope.parent) {
      const declarations = byScope.get(scope)?.get(reference.text)
      if (declarations) chain.push([scope, declarations])
    }
    chains.set(reference, chain)
    return chain
  }
  const resolveScoped = (reference: ts.Identifier): T | undefined => {
    for (const [scope, declarations] of chainOf(reference)) {
      const matches = declarations.filter((declaration) => visible(declaration, scope))
      if (matches.length > 0) return matches.map((declaration) => tracked.get(declaration.name)).find(Boolean)
    }
    return globals.get(reference.text)
  }
  const unresolvable = hasUnresolvableScope(nodes)
  return {
    declare: (name, value) => {
      if (tracked.has(name)) return false
      tracked.set(name, value)
      return true
    },
    resolve: (reference) => (unresolvable ? byName(reference.text) : resolveScoped(reference)),
  }
}
