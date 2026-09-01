import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import type { RpcRunnerSpec } from "../types"
import { asSenpiThinkingLevel } from "../../senpi/thinking-level"
import { MEMBER_EXTENSION_BUNDLE_NAME, MEMBER_PROCESS_ENV_NAMES } from "../../team/member-extension/identity"

const require = createRequire(import.meta.url)

const SESSION_DIR_ENV = "SENPI_CODING_AGENT_SESSION_DIR"
export const OMO_SENPI_TASK_RPC_CHILD = "OMO_SENPI_TASK_RPC_CHILD"
const SENPI_BIN_ENV = "SENPI_BIN"
const RPC_ENTRY_SPECIFIER = "@code-yeongyu/senpi/rpc-entry"

export type RpcSpawnSpec = RpcRunnerSpec & {
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type RpcSpawnDescriptor = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

export type SenpiLauncher = {
  readonly command: string
  readonly prefixArgs: readonly string[]
}

export type RpcSpawnRuntime = {
  readonly isBunBinary: boolean
  readonly execPath: string
  readonly platform: NodeJS.Platform
  readonly parentEnv: NodeJS.ProcessEnv
  readonly resolveRpcEntry: () => string
  // Injectable so tests can pin the executable-vs-fallback branch; defaults to resolveSenpiExecutable.
  readonly resolveSenpiExecutable?: (runtime: RpcSpawnRuntime) => string | null
}

/**
 * Detect whether the current process is a Bun compiled binary, mirroring
 * senpi's own detection (import.meta.url carries a $bunfs / ~BUN marker).
 */
export function detectBunBinary(metaUrl: string): boolean {
  return metaUrl.includes("$bunfs") || metaUrl.includes("~BUN") || metaUrl.includes("%7EBUN")
}

/**
 * The isolated, collision-free session dir for a child, nested under OUR state
 * dir so the child's JSONL transcript lives in the senpi-task namespace and
 * never in the user's real ~/.senpi sessions.
 */
export function resolveChildSessionDir(stateDir: string, taskId: string): string {
  return `${join(stateDir, "sessions", taskId)}${sep}`
}

function senpiBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "senpi.exe" : "senpi"
}

function scanPathForExecutable(name: string, pathValue: string | undefined): string | null {
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = canonicalExecutable(join(dir, name))
    if (candidate !== null) return candidate
  }
  return null
}

function canonicalExecutable(candidate: string): string | null {
  try {
    const canonical = realpathSync.native(resolve(candidate))
    return statSync(canonical).isFile() ? canonical : null
  } catch {
    return null
  }
}

/**
 * Resolve the senpi EXECUTABLE to spawn the rpc child with (`<exe> --mode rpc`). Spawning the binary
 * directly bypasses module resolution, which senpi's own loader alias HIJACKS when omo runs as a senpi
 * extension: `require.resolve("@code-yeongyu/senpi/rpc-entry")` then resolves to the running dist entry
 * instead of the child rpc entry and the child never boots. Preference order: an explicit `SENPI_BIN`
 * override, the sibling binary next to a Bun-compiled senpi, then a PATH scan. Returns null when no
 * executable is found so buildRpcSpawn can fall back to the documented `execPath + rpc-entry` path.
 */
export function resolveSenpiExecutable(runtime: RpcSpawnRuntime): string | null {
  const binaryName = senpiBinaryName(runtime.platform)
  const override = runtime.parentEnv[SENPI_BIN_ENV]?.trim()
  if (override !== undefined && override.length > 0) {
    if (override.includes("/") || override.includes(sep) || isAbsolute(override)) {
      return canonicalExecutable(override)
    }
    return scanPathForExecutable(override, runtime.parentEnv.PATH)
  }
  if (runtime.isBunBinary) {
    return canonicalExecutable(join(dirname(runtime.execPath), binaryName))
  }
  return scanPathForExecutable(binaryName, runtime.parentEnv.PATH)
}

function normalizeSenpiLauncher(executable: string, runtime: RpcSpawnRuntime): SenpiLauncher | null {
  if (runtime.platform !== "win32" || executable.toLowerCase().endsWith(".exe")) {
    return { command: executable, prefixArgs: [] }
  }
  const shimDir = dirname(executable)
  const cliCandidates = [
    join(shimDir, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js"),
    join(shimDir, "..", "@code-yeongyu", "senpi", "dist", "cli.js"),
  ]
  const cliPath = cliCandidates.find((candidate) => existsSync(candidate))
  return cliPath === undefined ? null : { command: runtime.execPath, prefixArgs: [cliPath] }
}

export function resolveSenpiLauncher(runtime: RpcSpawnRuntime): SenpiLauncher | null {
  const executable = (runtime.resolveSenpiExecutable ?? resolveSenpiExecutable)(runtime)
  if (executable !== null) {
    const normalized = normalizeSenpiLauncher(executable, runtime)
    if (normalized !== null) return normalized
  }
  if (runtime.platform !== "win32") return null
  for (const name of ["senpi.cmd", "senpi"]) {
    const npmShim = scanPathForExecutable(name, runtime.parentEnv.PATH)
    if (npmShim === null) continue
    const normalized = normalizeSenpiLauncher(npmShim, runtime)
    if (normalized !== null) return normalized
  }
  return null
}

/**
 * The child-facing argv tail shared by both spawn strategies: `--no-extensions` so the detached child
 * does NOT auto-load the parent's whole package set, then ONLY the threaded `-e` extensions, then the
 * threaded `--model` so the separate process resolves the requested provider/modelId.
 */
function isDagOwnedChild(spec: RpcRunnerSpec): boolean {
  if (basename(dirname(spec.state_dir)) !== "children" || basename(spec.state_dir) !== spec.task_id) return false
  const stateDir = dirname(dirname(spec.state_dir))
  const record = JSON.parse(readFileSync(join(stateDir, "tasks", `${spec.task_id}.json`), "utf8")) as unknown
  if (typeof record !== "object" || record === null || !("owner" in record)) return false
  const owner = record.owner
  return typeof owner === "object" && owner !== null && "kind" in owner && owner.kind === "dag"
}

export function buildChildArgs(spec: RpcRunnerSpec): readonly string[] {
  const args: string[] = ["--no-extensions"]
  // The OMO launcher prepends its own extension before user/provider entries. DAG-owned tasks drop
  // that first entry so the detached child cannot boot a task engine, while provider extensions
  // and every non-DAG child's extension list remain unchanged.
  const extensions = isDagOwnedChild(spec) ? (spec.extensions ?? []).slice(1) : spec.extensions ?? []
  for (const entry of extensions) {
    if (entry.length > 0) args.push("--extension", entry)
  }
  if (spec.model !== undefined && spec.model.length > 0) {
    args.push("--model", spec.model)
  }
  const thinkingLevel = asSenpiThinkingLevel(spec.reasoning ?? spec.variant)
  if (thinkingLevel !== undefined) {
    args.push("--thinking", thinkingLevel)
  }
  return args
}

export function buildModelCatalogArgs(spec: RpcRunnerSpec): readonly string[] {
  const args: string[] = ["--no-extensions"]
  for (const entry of spec.extensions ?? []) {
    if (entry.length > 0) args.push("--extension", entry)
  }
  args.push("--no-skills", "--no-prompt-templates", "--no-context-files", "--list-models")
  return args
}

function resolveRpcEntrySpecifier(): string {
  for (const modulesDir of require.resolve.paths(RPC_ENTRY_SPECIFIER) ?? []) {
    const candidate = join(modulesDir, "@code-yeongyu", "senpi", "dist", "rpc-entry.js")
    if (existsSync(candidate)) return candidate
  }
  if (typeof Bun !== "undefined") {
    return Bun.resolveSync(RPC_ENTRY_SPECIFIER, dirname(fileURLToPath(import.meta.url)))
  }
  return require.resolve(RPC_ENTRY_SPECIFIER)
}

function defaultRuntime(): RpcSpawnRuntime {
  return {
    isBunBinary: detectBunBinary(import.meta.url),
    execPath: process.execPath,
    platform: process.platform,
    parentEnv: process.env,
    resolveRpcEntry: resolveRpcEntrySpecifier,
  }
}

/**
 * Build the child spawn descriptor. The child inherits the parent env plus an isolated
 * SENPI_CODING_AGENT_SESSION_DIR; member-only identity is stripped before explicit memberEnv is
 * applied. The real agent dir is deliberately left unset so auth/models resolve normally. It prefers
 * the senpi EXECUTABLE (`<exe> --mode rpc <childArgs>`) so loader-alias hijacking cannot break child
 * resolution; when no executable is found it falls back to the documented `execPath + rpc-entry` path
 * (rpc-entry re-injects `--mode rpc`, so the child args follow the entry).
 */
/**
 * The env/extension preamble shared by the real child and the catalog probe. Both MUST strip member
 * identity identically, so the rule lives in exactly one place: a divergence here would silently leak
 * member identity into one of the two spawns.
 */
function buildChildProfile(
  spec: RpcSpawnSpec,
  resolved: RpcSpawnRuntime,
): { readonly env: NodeJS.ProcessEnv; readonly spec: RpcSpawnSpec } {
  const env: NodeJS.ProcessEnv = { ...resolved.parentEnv }
  for (const name of MEMBER_PROCESS_ENV_NAMES) delete env[name]
  Object.assign(env, spec.memberEnv)
  env[SESSION_DIR_ENV] = resolveChildSessionDir(spec.state_dir, spec.task_id)
  env[OMO_SENPI_TASK_RPC_CHILD] = "1"
  const extensions = spec.memberEnv === undefined
    ? spec.extensions?.filter((entry) => basename(entry) !== MEMBER_EXTENSION_BUNDLE_NAME)
    : spec.extensions
  return { env, spec: extensions === spec.extensions ? spec : { ...spec, extensions } }
}

export function buildRpcSpawn(spec: RpcSpawnSpec, runtime?: Partial<RpcSpawnRuntime>): RpcSpawnDescriptor {
  const resolved: RpcSpawnRuntime = { ...defaultRuntime(), ...runtime }
  const profile = buildChildProfile(spec, resolved)
  const env = profile.env
  const childArgs = buildChildArgs(profile.spec)
  const launcher = resolveSenpiLauncher(resolved)
  if (launcher !== null) {
    return {
      command: launcher.command,
      args: [...launcher.prefixArgs, "--mode", "rpc", ...childArgs],
      cwd: spec.cwd,
      env,
    }
  }
  return { command: resolved.execPath, args: [resolved.resolveRpcEntry(), ...childArgs], cwd: spec.cwd, env }
}

export function buildRpcModelCatalogSpawn(
  spec: RpcSpawnSpec,
  runtime?: Partial<RpcSpawnRuntime>,
): RpcSpawnDescriptor {
  const resolved: RpcSpawnRuntime = { ...defaultRuntime(), ...runtime }
  const profile = buildChildProfile(spec, resolved)
  const env = profile.env
  const childArgs = buildModelCatalogArgs(profile.spec)
  const launcher = resolveSenpiLauncher(resolved)
  if (launcher !== null) {
    return {
      command: launcher.command,
      args: [...launcher.prefixArgs, ...childArgs],
      cwd: spec.cwd,
      env,
    }
  }
  const cliEntry = join(dirname(resolved.resolveRpcEntry()), "cli.js")
  return { command: resolved.execPath, args: [cliEntry, ...childArgs], cwd: spec.cwd, env }
}
