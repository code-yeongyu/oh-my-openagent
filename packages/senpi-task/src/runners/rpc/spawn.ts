import { createRequire } from "node:module"
import { dirname, join, sep } from "node:path"

import type { RpcRunnerSpec } from "../types"

const require = createRequire(import.meta.url)

const SESSION_DIR_ENV = "SENPI_CODING_AGENT_SESSION_DIR"
const RPC_ENTRY_SPECIFIER = "@code-yeongyu/senpi/rpc-entry"

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
 * Build the child spawn descriptor. Mirrors senpi orchestrator's rpc-process
 * spawn (bun binary: `<execdir>/senpi --mode rpc`; node: execPath + rpc-entry)
 * WITHOUT depending on @code-yeongyu/senpi-orchestrator. The child inherits the
 * parent env untouched plus an isolated SENPI_CODING_AGENT_SESSION_DIR; the
 * real agent dir is deliberately left unset so auth/models resolve normally.
 */
export function buildRpcSpawn(spec: RpcRunnerSpec, runtime?: Partial<RpcSpawnRuntime>): RpcSpawnDescriptor {
  const resolved: RpcSpawnRuntime = { ...defaultRuntime(), ...runtime }
  const env: NodeJS.ProcessEnv = {
    ...resolved.parentEnv,
    [SESSION_DIR_ENV]: resolveChildSessionDir(spec.state_dir, spec.task_id),
  }
  if (resolved.isBunBinary) {
    const binary = resolved.platform === "win32" ? "senpi.exe" : "senpi"
    return { command: join(dirname(resolved.execPath), binary), args: ["--mode", "rpc"], cwd: spec.cwd, env }
  }
  return { command: resolved.execPath, args: [resolved.resolveRpcEntry()], cwd: spec.cwd, env }
}
