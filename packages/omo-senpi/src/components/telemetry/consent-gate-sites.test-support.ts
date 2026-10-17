import ts from "@typescript/typescript6"

// Finds every call SITE in a telemetry source that can write to disk, reach the network, start a
// process, or hand an event to a transport. A site is identified by its file, the chain of functions
// that encloses it, the guards it runs under, and its call text, so moving a call out of a gated
// branch or above an early return produces a new, unreviewed site instead of keeping a count equal.

export type WriterSite = {
  readonly file: string
  readonly fn: string
  readonly guard: string
  readonly call: string
}

const DISK = [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync", "writeSync", "write",
  "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "rename", "renameSync", "open", "openSync",
  "copyFile", "copyFileSync", "cp", "cpSync", "createWriteStream", "symlink", "symlinkSync",
  "link", "linkSync", "truncate", "truncateSync", "rm", "rmSync", "unlink", "unlinkSync",
]
const NETWORK = ["fetch", "request", "get", "connect", "createConnection", "sendBeacon", "udpSocket"]
const PROCESS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]
const TRANSPORT = [
  "createEventTelemetryClient", "createTelemetryClient", "createDefaultPostHogTransport",
  "recordDailyActive", "recordSenpiDailyActive", "getDailyActiveCaptureState",
  "writeTelemetryDiagnostic", "cleanupTelemetryDiagnostics", "captureEvent", "capture",
]
const SINK_MODULES = /^(?:node:)?(?:fs|fs\/promises|http|https|http2|net|tls|dgram|child_process)$/u
const NETWORK_OBJECTS = /^(?:http|https|http2|net|tls|dgram|Bun)$/u
const CONSTRUCTED_SINKS = new Set(["WebSocket", "XMLHttpRequest", "EventSource"])

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim()

function calleeName(expression: ts.Expression): { readonly name: string; readonly object: string } | undefined {
  if (ts.isIdentifier(expression)) return { name: expression.text, object: "" }
  if (ts.isPropertyAccessExpression(expression)) return { name: expression.name.text, object: expression.expression.getText() }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    return { name: expression.argumentExpression.text, object: expression.expression.getText() }
  }
  return undefined
}

type SinkImports = { readonly aliases: ReadonlyMap<string, string>; readonly namespaces: ReadonlySet<string> }

function sinkImports(source: ts.SourceFile): SinkImports {
  const aliases = new Map<string, string>()
  const namespaces = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!SINK_MODULES.test(statement.moduleSpecifier.text)) continue
    const clause = statement.importClause
    if (clause?.name !== undefined) namespaces.add(clause.name.text)
    const bindings = clause?.namedBindings
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) aliases.set(element.name.text, (element.propertyName ?? element.name).text)
  }
  return { aliases, namespaces }
}

function isSink(name: string, object: string, imports: SinkImports): boolean {
  const bare = object === ""
  const resolved = bare ? imports.aliases.get(name) ?? name : name
  const fromSinkModule = bare ? imports.aliases.has(name) : imports.namespaces.has(object) || NETWORK_OBJECTS.test(object)
  if (TRANSPORT.includes(resolved) || resolved === "fetch") return true
  if (resolved === "write") return object === "Bun" || fromSinkModule
  if (NETWORK.includes(resolved)) return fromSinkModule
  if (PROCESS.includes(resolved)) return bare || fromSinkModule
  return DISK.includes(resolved)
}

function functionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name !== undefined) return node.name.getText()
  }
  if (!(ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node))) return undefined
  if (ts.isConstructorDeclaration(node)) return "constructor"
  if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name !== undefined) return node.name.getText()
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return parent.name.getText()
  if (ts.isCallExpression(parent)) {
    const callee = calleeName(parent.expression)
    return `${callee?.name ?? "call"}(=>)`
  }
  return "=>"
}

function enclosingFunctions(node: ts.Node): string {
  const names: string[] = []
  for (let current = node.parent; current !== undefined; current = current.parent) {
    const name = functionName(current)
    if (name !== undefined) names.unshift(name)
  }
  return names.length === 0 ? "<module>" : names.join(">")
}

function exitsEarly(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement)) return false
  const branch = statement.thenStatement
  const last = ts.isBlock(branch) ? branch.statements.at(-1) : branch
  return last !== undefined && (ts.isReturnStatement(last) || ts.isThrowStatement(last))
}

/** The conditions a site runs under, outermost first, including early-exit guards before it. */
function guardsOf(node: ts.Node): string {
  const guards: string[] = []
  let child: ts.Node = node
  for (let current = node.parent; current !== undefined; child = current, current = current.parent) {
    if (ts.isIfStatement(current) && child !== current.expression) {
      guards.unshift(`${child === current.thenStatement ? "if" : "else"}(${squash(current.expression.getText())})`)
    } else if (ts.isConditionalExpression(current) && child !== current.condition) {
      guards.unshift(`${child === current.whenTrue ? "if" : "else"}(${squash(current.condition.getText())})`)
    } else if (ts.isBinaryExpression(current) && child === current.right) {
      const operator = current.operatorToken.kind
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) guards.unshift(`if(${squash(current.left.getText())})`)
      if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        guards.unshift(`else(${squash(current.left.getText())})`)
      }
    } else if ((ts.isBlock(current) || ts.isSourceFile(current)) && ts.isStatement(child)) {
      const before = current.statements.slice(0, current.statements.indexOf(child))
      for (const statement of before.filter(exitsEarly).reverse()) {
        if (ts.isIfStatement(statement)) guards.unshift(`unless(${squash(statement.expression.getText())})`)
      }
    }
    if (functionName(current) !== undefined) break
  }
  return guards.join(" ")
}

function callText(node: ts.CallExpression | ts.NewExpression): string {
  const first = node.arguments?.[0]
  const argument = first === undefined ? "" : squash(first.getText()).slice(0, 60)
  return `${squash(node.expression.getText())}(${argument})`
}

export function scanWriterSites(file: string, text: string): readonly WriterSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imports = sinkImports(source)
  const sites: WriterSite[] = []
  const record = (node: ts.CallExpression | ts.NewExpression, call: string): void => {
    sites.push({ file, fn: enclosingFunctions(node), guard: guardsOf(node), call })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression)
      if (callee !== undefined && isSink(callee.name, callee.object, imports)) record(node, callText(node))
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && CONSTRUCTED_SINKS.has(node.expression.text)) {
      record(node, `new ${callText(node)}`)
    } else if (ts.isIdentifier(node) && isSinkAlias(node.text, imports) && !isCalleeOrBinding(node)) {
      sites.push({ file, fn: enclosingFunctions(node), guard: guardsOf(node), call: `ref ${node.text}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

function isSinkAlias(name: string, imports: SinkImports): boolean {
  const resolved = imports.aliases.get(name)
  return resolved !== undefined && (DISK.includes(resolved) || NETWORK.includes(resolved) || PROCESS.includes(resolved))
}

function isCalleeOrBinding(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isCallExpression(parent) && parent.expression === node) return true
  return ts.isImportSpecifier(parent) || ts.isPropertyAccessExpression(parent) && parent.name === node
}

export const siteKey = (site: WriterSite): string => `${site.fn} | ${site.guard} | ${site.call}`
