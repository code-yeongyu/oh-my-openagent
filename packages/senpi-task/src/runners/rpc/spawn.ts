import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { delimiter, dirname, isAbsolute, join, sep } from "node:path"

import type { RpcRunnerSpec } from "../types"
import { asSenpiThinkingLevel } from "../../senpi/thinking-level"

const require = createRequire(import.meta.url)

const SESSION_DIR_ENV = "SENPI_CODING_AGENT_SESSION_DIR"
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
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
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
      return existsSync(override) ? override : null
    }
    return scanPathForExecutable(override, runtime.parentEnv.PATH)
  }
  if (runtime.isBunBinary) {
    return join(dirname(runtime.execPath), binaryName)
  }
  return scanPathForExecutable(binaryName, runtime.parentEnv.PATH)
}

/**
 * The child-facing argv tail shared by both spawn strategies: `--no-extensions` so the detached child
 * does NOT auto-load the parent's whole package set, then ONLY the threaded `-e` extensions, then the
 * threaded `--model` so the separate process resolves the requested provider/modelId.
 */
export function buildChildArgs(spec: RpcRunnerSpec): readonly string[] {
  const args: string[] = ["--no-extensions"]
  for (const entry of spec.extensions ?? []) {
    if (entry.length > 0) args.push("--extension", entry)
  }
  if (spec.model !== undefined && spec.model.length > 0) {
    args.push("--model", spec.model)
  }
  const thinkingLevel = asSenpiThinkingLevel(spec.variant)
  if (thinkingLevel !== undefined) {
    args.push("--thinking", thinkingLevel)
  }
  return args
}

function resolveRpcEntrySpecifier(): string {
  if (typeof Bun !== "undefined") {
    return Bun.resolveSync(RPC_ENTRY_SPECIFIER, import.meta.dir)
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
 * Build the child spawn descriptor. The child inherits the parent env untouched plus an isolated
 * SENPI_CODING_AGENT_SESSION_DIR; the real agent dir is deliberately left unset so auth/models resolve
 * normally. It prefers the senpi EXECUTABLE (`<exe> --mode rpc <childArgs>`) so loader-alias hijacking
 * cannot break child resolution; when no executable is found it falls back to the documented
 * `execPath + rpc-entry` path (rpc-entry re-injects `--mode rpc`, so the child args follow the entry).
 */
export function buildRpcSpawn(spec: RpcSpawnSpec, runtime?: Partial<RpcSpawnRuntime>): RpcSpawnDescriptor {
  const resolved: RpcSpawnRuntime = { ...defaultRuntime(), ...runtime }
  const env: NodeJS.ProcessEnv = {
    ...resolved.parentEnv,
    ...(spec.memberEnv ?? {}),
    [SESSION_DIR_ENV]: resolveChildSessionDir(spec.state_dir, spec.task_id),
  }
  const childArgs = buildChildArgs(spec)
  const executable = (resolved.resolveSenpiExecutable ?? resolveSenpiExecutable)(resolved)
  if (executable !== null) {
    return { command: executable, args: ["--mode", "rpc", ...childArgs], cwd: spec.cwd, env }
  }
  return { command: resolved.execPath, args: [resolved.resolveRpcEntry(), ...childArgs], cwd: spec.cwd, env }
}
