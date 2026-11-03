import ts from "@typescript/typescript6"
import { posix } from "node:path"

import { createTracer, unwrap } from "./telemetry-opt-out-env.trace.mjs"

// Static scan behind telemetry-opt-out-env.test.mjs. A QA source that names the runtime may launch it,
// so every process it starts must receive an env that an actual CALL of the opt-out helper produced.
// A spawn with no env option inherits the caller's environment, so it is unrouted too. Spawns of a
// literal command that is neither a launcher nor named after the runtime (git, ps, sysctl) are skipped.

export const RUNTIME = /senpi|omo-native|binary-runtime|plugin\/extensions|omo-ai/iu
// A source can start the runtime without naming it: the current executable, or one of its entry files
// (the root launcher and CLI bundles, the native launcher).
export const RUNTIME_ENTRY = /process\.(?:execPath|argv0)|\bdist\/cli(?:-node)?\b|\bbin\/(?:omo|oh-my-opencode)\.js\b|oh-my-openagent|lazycodex/u
const SPAWNERS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"])
const LAUNCHERS = /^(?:node|bun|bunx|npx|deno|sh|bash|zsh|cmd|cmd\.exe|pwsh|powershell|tmux|env|script|expect)$/u

function parse(path, source) {
  const kind = /\.[cm]?tsx?$/u.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind)
}

function childProcessNames(file) {
  const names = new Map()
  const namespaces = new Set()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !/^(?:node:)?child_process$/u.test(statement.moduleSpecifier.text)) continue
    const clause = statement.importClause
    if (clause?.name !== undefined) namespaces.add(clause.name.text)
    const bindings = clause?.namedBindings
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.set(element.name.text, (element.propertyName ?? element.name).text)
    }
  }
  return { names, namespaces }
}

function spawnerOf(call, processNames) {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return processNames.names.has(callee.text) ? processNames.names.get(callee.text) : undefined
  if (!ts.isPropertyAccessExpression(callee)) return undefined
  const owner = callee.expression.getText()
  if (owner === "Bun" && /^spawn(?:Sync)?$/u.test(callee.name.text)) return "Bun.spawn"
  return processNames.namespaces.has(owner) && SPAWNERS.has(callee.name.text) ? callee.name.text : undefined
}

function commandAndOptions(call, spawner) {
  const args = call.arguments.map(unwrap)
  const first = args[0]
  if (spawner === "Bun.spawn" && first !== undefined && ts.isObjectLiteralExpression(first)) {
    const cmd = first.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "cmd")
    const list = cmd === undefined ? undefined : unwrap(cmd.initializer)
    return { command: list !== undefined && ts.isArrayLiteralExpression(list) ? unwrap(list.elements[0]) : list, words: [list], options: first }
  }
  if (spawner === "Bun.spawn") {
    return { command: first !== undefined && ts.isArrayLiteralExpression(first) ? unwrap(first.elements[0]) : first, words: [first], options: args[1] }
  }
  if (spawner === "exec" || spawner === "execSync") return { command: first, words: [first], options: args[1] }
  const second = args[1]
  const options = args.length >= 3 ? args[2] : second !== undefined && ts.isObjectLiteralExpression(second) ? second : undefined
  return { command: first, words: [first, second], options }
}

const literal = (node) => node !== undefined && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))

function launchesRuntime({ command, words }) {
  if (!literal(command)) return true
  const name = posix.basename(command.text.trim().split(/\s+/u)[0] ?? "")
  return LAUNCHERS.test(name) || RUNTIME.test(command.text) || words.some((word) => word !== undefined && RUNTIME.test(word.getText()))
}

function envOf(options, tracer) {
  const value = unwrap(options)
  if (value === undefined) return false
  return tracer.memberReaches(value, "env", 0)
}

function enclosingFunction(node) {
  const names = []
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue
    const parent = current.parent
    const name = ts.isConstructorDeclaration(current) ? "constructor" : current.name?.getText()
      ?? (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ? parent.name.getText() : undefined)
    if (name !== undefined) names.unshift(name)
  }
  return names.length === 0 ? "<module>" : names.join(">")
}

/** Every runtime-capable spawn site whose env an opt-out helper call did not produce. */
export function findUnroutedSpawns(files) {
  const parsed = new Map()
  const parseFile = (path) => {
    if (!parsed.has(path)) {
      const entry = files.find((file) => file.path === path)
      parsed.set(path, entry === undefined ? undefined : parse(path, entry.source))
    }
    return parsed.get(path)
  }
  const tracer = createTracer(parseFile, files.map((file) => file.path))
  const sites = []
  for (const { path, source } of files) {
    if (!RUNTIME.test(source) && !RUNTIME_ENTRY.test(source)) continue
    const file = parseFile(path)
    const processNames = childProcessNames(file)
    const visit = (node) => {
      const spawner = ts.isCallExpression(node) ? spawnerOf(node, processNames) : undefined
      if (spawner !== undefined) {
        const shape = commandAndOptions(node, spawner)
        if (launchesRuntime(shape) && !envOf(shape.options, tracer)) {
          const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1
          sites.push({ path, fn: enclosingFunction(node), call: `${node.expression.getText()}(${node.arguments[0]?.getText().slice(0, 40) ?? ""})`, line })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return sites
}

const matches = (entry, site) => entry.file === site.path && entry.function === site.fn && entry.call === site.call
const expected = (entry) => entry.count ?? 1

/**
 * Unrouted sites with no reviewed bypass, plus bypass entries that no longer match an unrouted site.
 * A bypass is keyed by file, enclosing function and call text, so it never covers a new spawn.
 */
export function auditDriverSpawns(files, bypasses) {
  const sites = findUnroutedSpawns(files)
  const unrouted = sites
    .filter((site) => !bypasses.some((entry) => matches(entry, site)))
    .map((site) => `unrouted ${site.path}:${site.line} ${site.fn} ${site.call}`)
  const drifted = bypasses
    .map((entry) => ({ entry, found: sites.filter((site) => matches(entry, site)).length }))
    .filter(({ entry, found }) => entry.reason.trim() === "" || found !== expected(entry))
    .map(({ entry, found }) => `${found === 0 ? "stale" : "recount"} bypass ${entry.file} ${entry.function} ${entry.call} x${found} (reviewed x${expected(entry)})`)
  return [...unrouted, ...drifted]
}
