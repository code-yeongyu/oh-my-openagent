import ts from "@typescript/typescript6"

export type AllowlistEntry = { file: string; call: string; count: number; reason: string }
export type ScanItem = { path: string; content: string }
export type ScanVerdict = { offenders: string[]; stale: string[] }
export type RawTlsHit = { line: number; id: string; text: string }
type Binding = { module: string; member?: string; specifier?: string }
const CLIENTS: Record<string, readonly string[]> = {
  tls: ["connect", "createConnection", "TLSSocket", "createSecureContext", "checkServerIdentity"],
  https: ["request", "get", "Agent", "globalAgent"], http2: ["connect"], Bun: ["connect"],
}

function parse(content: string, file: string): ts.SourceFile {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
  const diagnostics: unknown = Reflect.get(source, "parseDiagnostics")
  if (!Array.isArray(diagnostics)) throw new SyntaxError(file + ": parser diagnostics unavailable")
  const first: unknown = diagnostics[0]
  if (first !== undefined) {
    const message = typeof first === "object" && first !== null && "messageText" in first
      && typeof first.messageText === "string" ? first.messageText : "invalid syntax"
    throw new SyntaxError(file + ": " + message)
  }
  return source
}

function allNodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = []
  const visit = (node: ts.Node): void => { result.push(node); ts.forEachChild(node, visit) }
  visit(root)
  return result
}

function literal(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left), right = literal(node.right)
    return left !== undefined && right !== undefined ? left + right : undefined
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text
    for (const span of node.templateSpans) {
      const part = literal(span.expression)
      if (part === undefined) return undefined
      value += part + span.literal.text
    }
    return value
  }
  return undefined
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node
}
function member(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return literal(node.argumentExpression)
  return undefined
}

function normalized(node: ts.Node, source: ts.SourceFile): string {
  const spans = allNodes(node).filter(n => ts.isStringLiteralLike(n) || ts.isRegularExpressionLiteral(n)
    || n.kind === ts.SyntaxKind.TemplateHead || n.kind === ts.SyntaxKind.TemplateMiddle || n.kind === ts.SyntaxKind.TemplateTail)
    .sort((a, b) => a.getStart(source) - b.getStart(source))
  const plain = (s: string): string => s.replace(/\s+/g, " ").replace(/\(\s+/g, "(")
    .replace(/,\s*([)}])/g, "$1").replace(/\s+([)}])/g, "$1")
  let end = node.getStart(source), text = ""
  for (const span of spans) {
    const start = span.getStart(source)
    if (start < end) continue
    text += plain(source.text.slice(end, start)) + source.text.slice(start, span.end)
    end = span.end
  }
  return (text + plain(source.text.slice(end, node.end))).trim().replace(/;$/, "")
}
export function normalizeCallText(text: string): string {
  const source = parse(text, "call.ts")
  return normalized(source, source)
}

export function findRawTlsClients(content: string, file = "source.ts"): RawTlsHit[] {
  const source = parse(content, file), list = allNodes(source)
  const bindings = new Map<string, Binding>([...Object.keys(CLIENTS), "globalThis"].map(module => [module, { module }]))
  const builtinNames = new Set<string>()
  const requireFactories = new Set<string>()
  const requireNames = new Set(["require", "__require"])
  const kind = (expression: ts.Expression | undefined): Binding | undefined => {
    if (!expression) return undefined
    const node = unwrap(expression)
    if (ts.isIdentifier(node)) return bindings.get(node.text)
    if (ts.isAwaitExpression(node)) return kind(node.expression)
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression), name = member(callee) ?? (ts.isIdentifier(callee) ? callee.text : undefined)
      const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee) ? unwrap(callee.expression) : undefined
      if (name === "get" && receiver && ts.isIdentifier(receiver) && receiver.text === "Reflect"
        && kind(node.arguments[0])?.module === "globalThis" && literal(node.arguments[1]) === "Bun") return { module: "Bun" }
      const factory = ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && requireFactories.has(callee.expression.text)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name && (requireNames.has(name) || name === "getBuiltinModule" || builtinNames.has(name)) || factory
        || (member(callee) === "call" && ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && requireNames.has(callee.expression.text))) {
        const specifier = literal(node.arguments[member(callee) === "call" ? 1 : 0])
        if (specifier) return { module: specifier.replace(/^node:/, ""), specifier }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = member(node)
      const base = kind(node.expression)
      if (base?.module === "globalThis" && name) return bindings.get(name)
      if (base && name && CLIENTS[base.module]?.includes(name)) return { ...base, member: name }
      if (base?.member && (name === "call" || name === "apply")) return base
    }
    return undefined
  }
  for (const node of list) {
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literal(node.moduleReference.expression), module = specifier?.replace(/^node:/, "")
      if (specifier && module && CLIENTS[module]) bindings.set(node.name.text, { module, specifier })
    }
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue
    const specifier = literal(node.moduleSpecifier), module = specifier?.replace(/^node:/, "")
    const clause = node.importClause, named = clause?.namedBindings
    if (!module || !specifier) continue
    if (clause?.name && CLIENTS[module]) bindings.set(clause.name.text, { module, specifier })
    if (named && ts.isNamespaceImport(named) && CLIENTS[module]) bindings.set(named.name.text, { module, specifier })
    if (named && ts.isNamedImports(named)) for (const spec of named.elements) {
      if (spec.isTypeOnly) continue
      const name = (spec.propertyName ?? spec.name).text
      if (module === "module" && name === "createRequire") requireFactories.add(spec.name.text)
      if (CLIENTS[module]) bindings.set(spec.name.text, name === "default" ? { module, specifier } : { module, member: name, specifier })
    }
  }
  let changed: boolean
  do {
    changed = false
    const bind = (name: string, value: Binding): void => {
      if (!bindings.has(name)) { bindings.set(name, value); changed = true }
    }
    for (const node of list) {
      if (!ts.isVariableDeclaration(node) || !node.initializer) continue
      const init = unwrap(node.initializer), value = kind(init)
      if (ts.isIdentifier(node.name) && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && requireFactories.has(init.expression.text)) requireNames.add(node.name.text)
      if (ts.isIdentifier(node.name) && value) bind(node.name.text, value)
      if (ts.isObjectBindingPattern(node.name)) for (const spec of node.name.elements) {
        const name = spec.propertyName ? literal(spec.propertyName) ?? spec.propertyName.getText(source) : spec.name.getText(source)
        if (ts.isIdentifier(init) && init.text === "process" && name === "getBuiltinModule" && ts.isIdentifier(spec.name)) builtinNames.add(spec.name.text)
        if (value && ts.isIdentifier(spec.name)) {
          if (name === "default" && CLIENTS[value.module]) bind(spec.name.text, value)
          else if (CLIENTS[value.module]?.includes(name)) bind(spec.name.text, { ...value, member: name })
        }
      }
    }
  } while (changed)
  const hits: RawTlsHit[] = [], seen = new Set<number>()
  const add = (node: ts.Node, id: string): void => {
    const start = node.getStart(source)
    if (seen.has(start)) return
    seen.add(start)
    hits.push({ line: source.getLineAndCharacterOfPosition(start).line + 1, id, text: normalized(node, source) })
  }
  for (const node of list) {
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
      && CLIENTS[literal(node.moduleReference.expression)?.replace(/^node:/, "") ?? ""]) add(node, "import-equals acquisition")
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && kind(node.right)?.module === "Bun") {
      const left = unwrap(node.left)
      if (ts.isObjectLiteralExpression(left) && left.properties.some(p =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
        && (literal(p.name) ?? p.name.getText(source)) === "connect")) add(node, "Bun.connect destructuring assignment")
    }
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && CLIENTS[literal(node.moduleSpecifier)?.replace(/^node:/, "") ?? ""]) {
      const named = node.importClause?.namedBindings
      if (!(named && ts.isNamedImports(named) && !node.importClause?.name && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly)))
        add(node, 'module access: import from "' + literal(node.moduleSpecifier) + '"')
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && CLIENTS[literal(node.moduleSpecifier)?.replace(/^node:/, "") ?? ""]) {
      if (!(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly)))
        add(node, 're-export from "' + literal(node.moduleSpecifier) + '"')
    }
    if (ts.isCallExpression(node)) {
      const value = kind(node)
      if (value?.specifier && !value.member && CLIENTS[value.module]) {
        const label = node.expression.kind === ts.SyntaxKind.ImportKeyword ? "import" : member(node.expression) === "getBuiltinModule" ? "getBuiltinModule" : "require"
        add(node, ts.isNoSubstitutionTemplateLiteral(node.arguments[0] ?? source) ? 'template ' + label + ' of "' + value.specifier + '"' : label + '("' + value.specifier + '")')
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const value = kind(node.expression)
      if (value?.member && CLIENTS[value.module]?.includes(value.member)) {
        const direct = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
        const id = direct ? (ts.isNewExpression(node) ? "new " : "") + value.module + "." + value.member + "(" : 'binding call: ' + node.expression.getText(source) + ' (imported from "' + value.specifier + '")'
        add(node, id)
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const value = kind(node)
      if (value?.module === "Bun" && value.member === "connect"
        && !((ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) && node.parent.expression === node)) add(node, "Bun.connect reference")
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && kind(node.initializer)?.module === "Bun"
      && node.name.elements.some(e => (e.propertyName ?? e.name).getText(source).replace(/["']/g, "") === "connect")) add(node, "Bun.connect destructuring")
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText(source) === "checkServerIdentity") add(node, "checkServerIdentity")
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && member(node.left) === "checkServerIdentity") add(node, "checkServerIdentity")
  }
  return hits.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))
}
