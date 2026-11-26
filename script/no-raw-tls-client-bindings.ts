import ts from "@typescript/typescript6"

// Which declarations bind a name for the TLS guard's scopes (#15071). The universe is every syntax kind for which the
// compiler's own `ts.isDeclaration` holds. Each is either a row of BINDING_KINDS, saying when a declaration of that kind
// shadows an outer name at runtime, or in NEVER_SHADOWS with the reason it never does. A declaration that does not
// shadow is still recorded (it can carry a client alias), so the scanner keeps reporting through it. A case the rules
// cannot decide without a type checker, or that depends on emit settings, does not shadow: when unsure, report.

export type Declaration = { readonly name: ts.Identifier; readonly scope: ts.Node; readonly shadows: boolean }

type Site = { readonly names: readonly ts.Identifier[]; readonly scope: ts.Node; readonly runtime: boolean }
type BindingRule = {
  readonly shadows: string
  readonly branches: readonly string[]
  readonly site: (node: ts.Node, argumentsUsers: ReadonlySet<ts.Node>) => Site | undefined
}

export function isFunctionScope(node: ts.Node): boolean {
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

export function bodyOf(fn: ts.Node): ts.Block | undefined {
  if (ts.isSourceFile(fn) || !isFunctionScope(fn)) return undefined
  const body: unknown = Reflect.get(fn, "body")
  return body !== undefined && ts.isBlock(body as ts.Node) ? (body as ts.Block) : undefined
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

function isAmbient(node: ts.Node): boolean {
  if (node.getSourceFile().isDeclarationFile) return true
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    const modifiers = ts.canHaveModifiers(current) ? ts.getModifiers(current) : undefined
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true
  }
  return false
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((modifier) => modifier.kind === kind) ?? false

// A top-level var in a classic script (a file that is not a module) is the global itself: a read before the
// assignment still reaches whatever the global held. An enum's emit extends an existing value the same way.
const isScriptTop = (scope: ts.Node): boolean => ts.isSourceFile(scope) && !ts.isExternalModule(scope)

const named = (node: { readonly name?: ts.Node }, scope: ts.Node, runtime: boolean): Site | undefined =>
  node.name && ts.isIdentifier(node.name) ? { names: [node.name], scope, runtime } : undefined

export const AMBIENT = "ambient (declare, inside declare global/module/namespace, or in a declaration file)"

export const BINDING_KINDS: ReadonlyMap<ts.SyntaxKind, BindingRule> = new Map<ts.SyntaxKind, BindingRule>([
  [
    ts.SyntaxKind.VariableDeclaration,
    {
      shadows: "unless ambient or a top-level var in a script; a catch binding always",
      branches: ["value", "catch binding", "top-level var in a script", AMBIENT],
      site: (node) => {
        if (!ts.isVariableDeclaration(node)) return undefined
        const names = bindingNames(node.name)
        if (ts.isCatchClause(node.parent)) return { names, scope: node.parent, runtime: true }
        if (!ts.isVariableDeclarationList(node.parent)) return undefined
        if ((node.parent.flags & ts.NodeFlags.BlockScoped) !== 0)
          return { names, scope: enclosing(node.parent, isScope), runtime: true }
        const fn = enclosing(node.parent, isFunctionScope)
        return { names, scope: bodyOf(fn) ?? fn, runtime: !isScriptTop(fn) }
      },
    },
  ],
  [
    ts.SyntaxKind.Parameter,
    {
      shadows: "unless its function reads `arguments` (a signature's parameters have no body to shadow in), or ambient",
      branches: ["value", "function reads arguments", "signature only", AMBIENT],
      site: (node, argumentsUsers) =>
        ts.isParameter(node)
          ? {
              names: bindingNames(node.name),
              scope: node.parent,
              runtime: !argumentsUsers.has(node.parent),
            }
          : undefined,
    },
  ],
  [
    ts.SyntaxKind.FunctionExpression,
    {
      shadows: "always, inside itself",
      branches: ["value"],
      site: (node) => (ts.isFunctionExpression(node) ? named(node, node, true) : undefined),
    },
  ],
  [
    ts.SyntaxKind.ClassExpression,
    {
      shadows: "always, inside itself",
      branches: ["value"],
      site: (node) => (ts.isClassExpression(node) ? named(node, node, true) : undefined),
    },
  ],
  [
    ts.SyntaxKind.FunctionDeclaration,
    {
      shadows: "when it has a body (a signature is erased; its implementation is its own declaration), unless ambient",
      branches: ["value", "signature only", "signature with implementation", AMBIENT],
      site: (node) =>
        ts.isFunctionDeclaration(node) ? named(node, enclosing(node, isScope), node.body !== undefined) : undefined,
    },
  ],
  [
    ts.SyntaxKind.ClassDeclaration,
    {
      shadows: "unless ambient",
      branches: ["value", AMBIENT],
      site: (node) => (ts.isClassDeclaration(node) ? named(node, enclosing(node, isScope), true) : undefined),
    },
  ],
  [
    ts.SyntaxKind.EnumDeclaration,
    {
      shadows: "unless const (emit settings decide whether it leaves an object), top-level in a script, or ambient",
      branches: ["value", "const", "top-level in a script", AMBIENT],
      site: (node) =>
        ts.isEnumDeclaration(node)
          ? named(
              node,
              enclosing(node, isScope),
              !hasModifier(node, ts.SyntaxKind.ConstKeyword) && !isScriptTop(enclosing(node, isScope)),
            )
          : undefined,
    },
  ],
  [
    ts.SyntaxKind.ImportEqualsDeclaration,
    {
      shadows: "a require form unless type-only; an entity name never (it may name a type, and only a checker knows)",
      branches: ["require", "entity name", "type-only"],
      site: (node) =>
        ts.isImportEqualsDeclaration(node)
          ? named(
              node,
              enclosing(node, isScope),
              !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference),
            )
          : undefined,
    },
  ],
  [
    ts.SyntaxKind.ImportClause,
    {
      shadows: "its default name, unless type-only",
      branches: ["value", "type-only"],
      site: (node) => (ts.isImportClause(node) ? named(node, node.getSourceFile(), !node.isTypeOnly) : undefined),
    },
  ],
  [
    ts.SyntaxKind.NamespaceImport,
    {
      shadows: "unless type-only",
      branches: ["value", "type-only"],
      site: (node) =>
        ts.isNamespaceImport(node) ? named(node, node.getSourceFile(), !node.parent.isTypeOnly) : undefined,
    },
  ],
  [
    ts.SyntaxKind.ImportSpecifier,
    {
      shadows: "unless the import or the specifier is type-only",
      branches: ["value", "type-only import", "type-only specifier"],
      site: (node) =>
        ts.isImportSpecifier(node)
          ? named(node, node.getSourceFile(), !node.isTypeOnly && !node.parent.parent.isTypeOnly)
          : undefined,
    },
  ],
])

const MEMBER = "a member or property name, not a lexical binding"
const TYPE = "a type only, erased by every emit"

export const NEVER_SHADOWS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.TypeParameter, TYPE],
  [ts.SyntaxKind.InterfaceDeclaration, TYPE],
  [ts.SyntaxKind.TypeAliasDeclaration, TYPE],
  [ts.SyntaxKind.NamedTupleMember, TYPE],
  [ts.SyntaxKind.PropertySignature, MEMBER],
  [ts.SyntaxKind.PropertyDeclaration, MEMBER],
  [ts.SyntaxKind.MethodSignature, MEMBER],
  [ts.SyntaxKind.MethodDeclaration, MEMBER],
  [ts.SyntaxKind.GetAccessor, MEMBER],
  [ts.SyntaxKind.SetAccessor, MEMBER],
  [ts.SyntaxKind.PropertyAssignment, MEMBER],
  [ts.SyntaxKind.ShorthandPropertyAssignment, MEMBER],
  [ts.SyntaxKind.EnumMember, MEMBER],
  [ts.SyntaxKind.JsxAttribute, MEMBER],
  [ts.SyntaxKind.Constructor, "has no name"],
  [ts.SyntaxKind.ClassStaticBlockDeclaration, "has no name"],
  [ts.SyntaxKind.ArrowFunction, "has no name"],
  [ts.SyntaxKind.BindingElement, "its names are bound by the variable or parameter it belongs to"],
  [ts.SyntaxKind.ExportSpecifier, "binds no local name"],
  [ts.SyntaxKind.NamespaceExport, "binds no local name"],
  [ts.SyntaxKind.NamespaceExportDeclaration, "binds no local name (a declaration-file global alias)"],
  [
    ts.SyntaxKind.ModuleDeclaration,
    "not tracked: a namespace may hold values, and leaving it unbound only adds reports",
  ],
  [ts.SyntaxKind.JSDocCallbackTag, "a comment: binds nothing at runtime"],
  [ts.SyntaxKind.JSDocTypedefTag, "a comment: binds nothing at runtime"],
  [ts.SyntaxKind.JSDocPropertyTag, "a comment: binds nothing at runtime"],
])

export function declarationsOf(node: ts.Node, argumentsUsers: ReadonlySet<ts.Node>): Declaration[] {
  const site = BINDING_KINDS.get(node.kind)?.site(node, argumentsUsers)
  if (!site) return []
  const shadows = site.runtime && !isAmbient(node)
  return site.names.map((name) => ({ name, scope: site.scope, shadows }))
}
