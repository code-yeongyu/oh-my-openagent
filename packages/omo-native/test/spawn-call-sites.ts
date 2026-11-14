// The call-site rule of remote-local-reachability.test.ts (omo#13440, design v7 section 7, rule 3): every call that can
// start a process, found by parsing each file and resolving its bindings, never by matching call text. A spawner is a
// `node:child_process` import (named, aliased, default or namespace member), `Bun.spawn`/`Bun.spawnSync`/`Bun.$` (as a
// member or a destructured handle), any `.spawn(`/`.spawnSync(` member call (a runtime handle such as `globalThis.Bun`
// held in a variable), or a WRAPPER: a function or object method whose spawn call takes its command or argv from its
// own parameters. Wrappers carry across exports, re-exports, aliases and parameter defaults, so each caller of a
// wrapper is pinned with the literal it passes, and a caller that is not itself a wrapper ends the chain.
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { parseSync } from "oxc-parser"

type AstNode = { readonly type: string; readonly start: number; readonly end: number }

const PROCESS_MODULES = new Set(["node:child_process", "child_process"])
const BUN_SPAWNERS = new Set(["spawn", "spawnSync", "$"])
const HANDLE_SPAWNERS = new Set(["spawn", "spawnSync"])
const NAMESPACE = "*"
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
const child = (node: AstNode | undefined, key: string): AstNode | undefined => {
  const value: unknown = node === undefined ? undefined : Reflect.get(node, key)
  return isNode(value) ? value : undefined
}
const children = (node: AstNode | undefined, key: string): AstNode[] => {
  const value: unknown = node === undefined ? undefined : Reflect.get(node, key)
  return Array.isArray(value) ? value.filter(isNode) : []
}
const text = (node: AstNode | undefined, key: string): string | undefined => {
  const value: unknown = node === undefined ? undefined : Reflect.get(node, key)
  return typeof value === "string" ? value : undefined
}
// Import/export specifiers may be identifiers or string literals.
const nameOf = (node: AstNode | undefined): string | undefined => text(node, "name") ?? text(node, "value")

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node)
  for (const key of Object.keys(node)) {
    const value: unknown = Reflect.get(node, key)
    if (Array.isArray(value)) for (const item of value) if (isNode(item)) walk(item, visit)
    if (isNode(value)) walk(value, visit)
  }
}

function boundNames(pattern: AstNode | undefined): string[] {
  if (pattern === undefined) return []
  if (pattern.type === "Identifier") return [nameOf(pattern) ?? ""]
  if (pattern.type === "AssignmentPattern") return boundNames(child(pattern, "left"))
  if (pattern.type === "RestElement") return boundNames(child(pattern, "argument"))
  if (pattern.type === "ArrayPattern") return children(pattern, "elements").flatMap(boundNames)
  if (pattern.type === "ObjectPattern")
    return children(pattern, "properties").flatMap((property) =>
      boundNames(property.type === "RestElement" ? property : child(property, "value")),
    )
  return []
}

function references(node: AstNode | undefined, names: ReadonlySet<string>): boolean {
  if (node === undefined) return false
  let found = false
  walk(node, (inner) => {
    if (inner.type === "Identifier" && names.has(nameOf(inner) ?? "")) found = true
  })
  return found
}

/** A function's parameters plus every local whose initializer reads one of them, to a fixed point. */
function taintedNames(fn: AstNode): Set<string> {
  const tainted = new Set(children(fn, "params").flatMap(boundNames))
  const declarators: AstNode[] = []
  walk(fn, (inner) => {
    if (inner.type === "VariableDeclarator") declarators.push(inner)
  })
  let grew = true
  while (grew) {
    grew = false
    for (const declarator of declarators)
      if (references(child(declarator, "init"), tainted))
        for (const name of boundNames(child(declarator, "id")))
          if (!tainted.has(name)) {
            tainted.add(name)
            grew = true
          }
  }
  return tainted
}

type Binding = { readonly module: string; readonly name: string }

interface ParsedFile {
  readonly file: string
  readonly source: string
  readonly program: AstNode
  readonly imports: ReadonlyMap<string, Binding>
  /** Named functions: top-level declarations, `const f = () => ...`, and object methods (by property name). */
  readonly functions: readonly { readonly name: string; readonly fn: AstNode; readonly method: boolean }[]
  readonly exports: ReadonlyMap<string, string | Binding>
  readonly starExports: readonly string[]
  /** `const x = y` and parameter defaults `x = y`: x -> y, for aliasing a spawner. */
  readonly aliases: readonly (readonly [string, string])[]
  readonly bunHandles: ReadonlySet<string>
}

function parseFile(repoRoot: string, file: string): ParsedFile {
  const absolute = join(repoRoot, file)
  const source = readFileSync(absolute, "utf8")
  const parsed = parseSync(absolute, source)
  if (parsed.errors.length > 0) throw new Error(`${file}: ${parsed.errors[0]?.message}`)
  const program: unknown = parsed.program
  if (!isNode(program)) throw new Error(`${file}: the parser returned no program`)
  const moduleOf = (specifier: string): string => {
    if (specifier.startsWith("node:") || PROCESS_MODULES.has(specifier)) return specifier
    const resolved = realpathSync(Bun.resolveSync(specifier, dirname(absolute)))
    return resolved.startsWith(`${repoRoot}/`) && !resolved.includes("/node_modules/")
      ? relative(repoRoot, resolved)
      : specifier
  }
  const imports = new Map<string, Binding>()
  const exports = new Map<string, string | Binding>()
  const starExports: string[] = []
  for (const statement of children(program, "body")) {
    const from = text(child(statement, "source"), "value")
    if (statement.type === "ImportDeclaration" && from !== undefined) {
      const module = moduleOf(from)
      for (const specifier of children(statement, "specifiers")) {
        const local = nameOf(child(specifier, "local"))
        if (local === undefined) continue
        const imported =
          specifier.type === "ImportSpecifier"
            ? (nameOf(child(specifier, "imported")) ?? local)
            : specifier.type === "ImportDefaultSpecifier"
              ? "default"
              : NAMESPACE
        imports.set(local, { module, name: imported })
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      const declaration = child(statement, "declaration")
      const declared =
        declaration?.type === "VariableDeclaration"
          ? children(declaration, "declarations").flatMap((declarator) => boundNames(child(declarator, "id")))
          : [nameOf(child(declaration, "id"))].filter((name) => name !== undefined)
      for (const name of declared) exports.set(name, name)
      for (const specifier of children(statement, "specifiers")) {
        const local = nameOf(child(specifier, "local"))
        const exported = nameOf(child(specifier, "exported")) ?? local
        if (local === undefined || exported === undefined) continue
        exports.set(exported, from === undefined ? local : { module: moduleOf(from), name: local })
      }
    } else if (statement.type === "ExportAllDeclaration" && from !== undefined) {
      if (child(statement, "exported") === undefined) starExports.push(moduleOf(from))
    } else if (statement.type === "ExportDefaultDeclaration") {
      const name = nameOf(child(child(statement, "declaration"), "id")) ?? nameOf(child(statement, "declaration"))
      if (name !== undefined) exports.set("default", name)
    }
  }
  const functions: { name: string; fn: AstNode; method: boolean }[] = []
  const aliases: (readonly [string, string])[] = []
  const bunHandles = new Set<string>()
  walk(program, (node) => {
    if (node.type === "FunctionDeclaration" && child(node, "body") !== undefined) {
      const name = nameOf(child(node, "id"))
      if (name !== undefined) functions.push({ name, fn: node, method: false })
    }
    if (node.type === "VariableDeclarator") {
      const id = child(node, "id")
      const init = child(node, "init")
      const name = id?.type === "Identifier" ? nameOf(id) : undefined
      if (name !== undefined && init !== undefined && FUNCTION_TYPES.has(init.type))
        functions.push({ name, fn: init, method: false })
      if (name !== undefined && init?.type === "Identifier") aliases.push([name, nameOf(init) ?? ""])
      if (init?.type === "Identifier" && nameOf(init) === "Bun" && id?.type === "ObjectPattern")
        for (const property of children(id, "properties")) {
          const key = nameOf(child(property, "key"))
          const value = nameOf(child(property, "value")) ?? key
          if (key !== undefined && value !== undefined && BUN_SPAWNERS.has(key)) bunHandles.add(value)
        }
    }
    if (node.type === "Property" || node.type === "MethodDefinition") {
      const key = nameOf(child(node, "key"))
      const value = child(node, "value")
      if (key !== undefined && value !== undefined && FUNCTION_TYPES.has(value.type))
        functions.push({ name: key, fn: value, method: true })
    }
    if (node.type === "AssignmentPattern") {
      const left = child(node, "left")
      const right = child(node, "right")
      if (left?.type === "Identifier" && right?.type === "Identifier") aliases.push([nameOf(left) ?? "", nameOf(right) ?? ""])
    }
  })
  return { file, source, program, imports, functions, exports, starExports, aliases, bunHandles }
}

function render(node: AstNode | undefined, source: string): string {
  if (node === undefined) return "-"
  if (node.type === "ObjectExpression")
    return `{${children(node, "properties")
      .map((property) => nameOf(child(property, "key")) ?? "...")
      .join(",")}}`
  const raw = source.slice(node.start, node.end).replace(/\s+/g, " ")
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw
}

type Site = { readonly label: string; readonly args: readonly (AstNode | undefined)[] }

/**
 * Every spawn call site in `files` (repo-relative paths from the bundler's graph), each
 * `<file>: <spawner>(<arg0>; <arg1>)`, sorted. Arguments are rendered from source, an object argument by its keys.
 * A module that only re-exports (and so is absent from a bundler graph) is parsed when a binding passes through it.
 */
export function spawnCallSites(repoRoot: string, files: readonly string[]): string[] {
  const root = realpathSync(repoRoot)
  const parsed = new Map<string, ParsedFile>()
  const load = (file: string): ParsedFile | undefined => {
    if (!/\.(?:ts|js|mjs)$/.test(file) || !existsSync(join(root, file))) return undefined
    let entry = parsed.get(file)
    if (entry === undefined) {
      entry = parseFile(root, file)
      parsed.set(file, entry)
    }
    return entry
  }
  for (const file of files) load(file)
  const exported = new Map<string, Set<string>>()
  const local = new Map<string, Set<string>>()
  const methods = new Map<string, Set<string>>()
  const isExported = (module: string, name: string): boolean => {
    load(module)
    return exported.get(module)?.has(name) === true
  }
  const labelOf = (file: ParsedFile, callee: AstNode | undefined): string | undefined => {
    if (callee === undefined) return undefined
    if (callee.type === "LogicalExpression" || callee.type === "ConditionalExpression")
      return [child(callee, "left"), child(callee, "right"), child(callee, "consequent"), child(callee, "alternate")]
        .map((part) => labelOf(file, part))
        .find((label) => label !== undefined)
    if (callee.type === "ParenthesizedExpression") return labelOf(file, child(callee, "expression"))
    if (callee.type === "Identifier") {
      const name = nameOf(callee) ?? ""
      if (file.bunHandles.has(name)) return `Bun.${name}`
      if (local.get(file.file)?.has(name)) return name
      const binding = file.imports.get(name)
      if (binding === undefined) return undefined
      if (PROCESS_MODULES.has(binding.module)) return `node:child_process#${binding.name}`
      return isExported(binding.module, binding.name) ? `${binding.module}#${binding.name}` : undefined
    }
    if (callee.type === "StaticMemberExpression" || callee.type === "MemberExpression") {
      const object = child(callee, "object")
      const member = nameOf(child(callee, "property")) ?? ""
      const objectName = object?.type === "Identifier" ? (nameOf(object) ?? "") : undefined
      if (objectName === "Bun") return BUN_SPAWNERS.has(member) ? `Bun.${member}` : undefined
      const binding = objectName === undefined ? undefined : file.imports.get(objectName)
      if (binding !== undefined && (binding.name === NAMESPACE || binding.name === "default")) {
        if (PROCESS_MODULES.has(binding.module)) return `node:child_process#${member}`
        if (isExported(binding.module, member)) return `${binding.module}#${member}`
      }
      if (HANDLE_SPAWNERS.has(member) || methods.get(file.file)?.has(member)) return `${render(object, file.source)}.${member}`
    }
    return undefined
  }
  const sitesIn = (file: ParsedFile, node: AstNode): Site[] => {
    const sites: Site[] = []
    walk(node, (inner) => {
      const isCall = inner.type === "CallExpression"
      if (!isCall && inner.type !== "TaggedTemplateExpression") return
      const label = labelOf(file, child(inner, isCall ? "callee" : "tag"))
      if (label !== undefined) sites.push({ label, args: isCall ? children(inner, "arguments") : [child(inner, "quasi")] })
    })
    return sites
  }
  let changed = true
  const add = (set: Set<string>, name: string): void => {
    if (set.has(name)) return
    set.add(name)
    changed = true
  }
  while (changed) {
    changed = false
    for (const file of [...parsed.values()]) {
      const locals = local.get(file.file) ?? new Set<string>()
      local.set(file.file, locals)
      const methodNames = methods.get(file.file) ?? new Set<string>()
      methods.set(file.file, methodNames)
      for (const { name, fn, method } of file.functions) {
        const tainted = taintedNames(fn)
        if (sitesIn(file, fn).some((site) => site.args.slice(0, 2).some((arg) => references(arg, tainted))))
          add(method ? methodNames : locals, name)
      }
      for (const [alias, target] of file.aliases)
        if (labelOf(file, { type: "Identifier", start: 0, end: 0, name: target } as AstNode) !== undefined) add(locals, alias)
      const exportedHere = exported.get(file.file) ?? new Set<string>()
      exported.set(file.file, exportedHere)
      for (const [name, target] of file.exports) {
        const binding = typeof target === "string" ? file.imports.get(target) : target
        const spawner =
          (typeof target === "string" && locals.has(target)) ||
          (binding !== undefined && (PROCESS_MODULES.has(binding.module) || isExported(binding.module, binding.name)))
        if (spawner) add(exportedHere, name)
      }
      for (const module of file.starExports) {
        load(module)
        for (const name of exported.get(module) ?? []) add(exportedHere, name)
      }
    }
  }
  return files
    .flatMap((file) => {
      const entry = parsed.get(file)
      if (entry === undefined) return []
      return sitesIn(entry, entry.program).map(
        (site) => `${file}: ${site.label}(${render(site.args[0], entry.source)}; ${render(site.args[1], entry.source)})`,
      )
    })
    .sort()
}
