// The module-graph scan both remote reachability contracts share (omo#13440, design v7 section 7): each root's
// graph comes from Bun's own bundler metafile, and its sources are read for network calls, workers and Bun's spawn
// primitives. `remote-local-reachability.test.ts` pins the local-only verbs' graph;
// `remote-local-leg-reachability.test.ts` pins what the lazily loaded operator endpoint leg adds to it.
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseSync } from "oxc-parser"

export const repoRoot = join(import.meta.dir, "..", "..", "..")
export const at = (path: string) => join(repoRoot, path)

export const TRANSPORT = "packages/device-service-core/src/local-api/transport.ts"
export const STORE_WORKER = "packages/omo-senpi/src/components/thread/gateway/store-worker.ts"
/**
 * What an `omo remote` local-only verb runs through, each root with the files its graph must hold: its entry
 * (`remote-local.ts`: the account read, the session verbs, the thread adapter over the local API), the gateway store
 * worker, and the runtime pruning run after the verb.
 */
export const LOCAL_ONLY_ROOTS: Record<string, readonly string[]> = {
  "packages/omo-native/remote-local.ts": [
    "packages/omo-native/remote-local.ts",
    TRANSPORT,
    "packages/omo-native/remote-session-verbs.ts",
  ],
  [STORE_WORKER]: [STORE_WORKER],
  "packages/omo-native/runtime-prune.ts": ["packages/omo-native/runtime-prune.ts"],
}

export const NETWORK_MODULES = new Set(["tls", "https", "http", "http2", "dgram", "dns"])
const SPAWN_SHIM = "packages/omo-opencode/src/shared/bun-spawn-shim.ts"
const RUNTIME_WRAPPERS = "packages/utils/src/runtime/"
const NETWORK_CALL =
  /(?<![.\w$])fetch\s*\(|\?\?\s*(?:globalThis\.)?fetch\b|globalThis\.fetch\b|\boptions\.fetch\b|\bnew\s+WebSocket\b|\bBun\.(?:connect|listen|fetch)\b/g
const WORKER = /\bnew\s+Worker\b/g
const BUN_PRIMITIVE = /\bBun\s*\.\s*(?:spawnSync|spawn|\$)/g

export type Input = {
  readonly imports: readonly { readonly path: string; readonly external?: boolean }[]
}

async function graph(root: string): Promise<Record<string, Input>> {
  const built = (await Bun.build({
    entrypoints: [at(root)],
    target: "bun",
    metafile: true,
    throw: false,
    root: repoRoot,
  } as Parameters<typeof Bun.build>[0])) as Awaited<ReturnType<typeof Bun.build>> & {
    readonly metafile?: { readonly inputs: Record<string, Input> }
  }
  if (!built.success) throw new Error(`the bundler failed on ${root}: ${built.logs.join("\n")}`)
  const inputs = built.metafile?.inputs
  if (inputs === undefined || Object.keys(inputs).length === 0)
    throw new Error(`the bundler returned no module graph for ${root}`)
  return Object.fromEntries(
    Object.entries(inputs).map(([file, input]) => [relative(repoRoot, at(file)).replaceAll("\\", "/"), input]),
  )
}

/** The roots' module graphs merged; a root whose graph lacks one of its sentinel files throws. */
export async function rootsGraph(roots: Record<string, readonly string[]>): Promise<Record<string, Input>> {
  const inputs: Record<string, Input> = {}
  for (const [root, sentinels] of Object.entries(roots)) {
    const own = await graph(root)
    const missing = sentinels.filter((sentinel) => !(sentinel in own))
    if (missing.length > 0) throw new Error(`${root}'s module graph lacks ${missing.join(", ")}`)
    Object.assign(inputs, own)
  }
  return inputs
}

export const sourcesOf = (inputs: Record<string, Input>): string[] =>
  Object.keys(inputs).filter((file) => /\.(?:ts|js|mjs)$/.test(file) && !file.includes("node_modules/"))

export const importersOf = (inputs: Record<string, Input>, matches: (path: string) => boolean): string[] =>
  Object.entries(inputs)
    .filter(([, input]) => input.imports.some((entry) => matches(entry.path.replaceAll("\\", "/"))))
    .map(([file]) => file)
    .sort()
export const builtin = (name: string) => (path: string) => path.replace(/^node:/, "") === name
/** A module that can start a process: node:child_process, the utils runtime wrappers or the Bun spawn shim. */
export const spawnModule = (path: string): boolean =>
  builtin("child_process")(path) || path.startsWith(RUNTIME_WRAPPERS) || path === SPAWN_SHIM

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")

/** Each source's network calls (`<file>: <match>`), the files that build a Worker, and the Bun spawn primitive uses. */
export function scanSources(files: readonly string[]): {
  readonly calls: string[]
  readonly workers: string[]
  readonly bunPrimitives: Record<string, number>
} {
  const calls: string[] = []
  const workers: string[] = []
  const bunPrimitives: Record<string, number> = {}
  for (const file of files) {
    const source = withoutComments(readFileSync(at(file), "utf8"))
    for (const match of source.matchAll(NETWORK_CALL)) calls.push(`${file}: ${match[0]}`)
    if ((source.match(WORKER) ?? []).length > 0) workers.push(file)
    const primitives = (source.match(BUN_PRIMITIVE) ?? []).length
    if (primitives > 0) bunPrimitives[file] = primitives
  }
  return { calls: calls.sort(), workers: workers.sort(), bunPrimitives }
}

const field = (node: unknown, key: string): unknown =>
  typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined
// A callee that is createConnection itself, or picks it as a fallback (`(options.connect ?? createConnection)`).
const namesCreateConnection = (callee: unknown): boolean => {
  const type = field(callee, "type")
  if (type === "Identifier") return field(callee, "name") === "createConnection"
  if (type === "ParenthesizedExpression") return namesCreateConnection(field(callee, "expression"))
  if (type === "LogicalExpression" || type === "ConditionalExpression")
    return ["left", "right", "consequent", "alternate"].some((key) => namesCreateConnection(field(callee, key)))
  return false
}

/** Every call of node:net's createConnection in `file`, as written, sorted. */
export function connectCalls(file: string): string[] {
  const source = readFileSync(at(file), "utf8")
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (field(node, "type") === "CallExpression" && namesCreateConnection(field(node, "callee")))
      found.push(source.slice(Number(field(node, "start")), Number(field(node, "end"))))
    for (const value of Object.values(node)) visit(value)
  }
  visit(parseSync(file, source).program)
  return found.sort()
}
