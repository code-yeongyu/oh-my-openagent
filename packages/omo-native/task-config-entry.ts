/**
 * The task-config runtime `omo daemon` loads from the staged payload (`plugin/runtime/task-config/index.js`,
 * bundled by script/build-omo-native.ts). The launcher is plain JS and cannot load TypeScript sources, so
 * this bundle is how it reads its `task.*` settings through the one loader every other `task.*` key goes
 * through (omo-config-core: ~/.omo/omo.jsonc or ~/.omo/omo.json plus project `.omo` layers, JSONC),
 * instead of a copy of the file lookup, the parse or the precedence.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  loadOmoConfig,
  mergeOmoConfigRecords,
  OmoMemorySettingsSchema,
  resolveOmoConfigView,
  resolveUserOmoConfigDirectory,
  type OmoConfigEnv,
  type OmoMemorySettings,
} from "@oh-my-opencode/omo-config-core"

/** The `task.*` keys `omo daemon` reads. Each is present only when a loaded layer sets it, so the caller can
 * tell "configured" from the schema default. */
export type DaemonTaskSettings = {
  readonly host_engine_policy?: "upgrade" | "fallback"
  readonly host_idle_exit_ms?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The memory settings `omo doctor --fix` applies to every identity on the host. */
type GlobalMemorySettings = Pick<OmoMemorySettings, "runtime" | "agents">

/**
 * `memory.runtime` and `memory.agents` of the user's GLOBAL omo config only, resolved by the loader the
 * session uses (harness "senpi": the legacy `[senpi]` block, then `[native]`, then the active profile, each
 * merged key by key down to every agent's runtime field). `--fix` sweeps identities of every project, so the
 * loader sees no project layer. Undefined when no global file loaded (absent or unreadable).
 */
export function resolveGlobalMemorySettings(input: { readonly env: OmoConfigEnv }): GlobalMemorySettings | undefined {
  const directory = resolveUserOmoConfigDirectory(input.env)
  const userFiles = new Set([join(directory, "omo.jsonc"), join(directory, "omo.json")])
  const loaded = loadOmoConfig({
    cwd: directory,
    env: input.env,
    harness: "senpi",
    fileSystem: {
      existsSync: (path) => userFiles.has(path) && existsSync(path),
      readFileSync: (path, encoding) => readFileSync(path, encoding),
    },
  })
  if (!loaded.sources.some((source) => source.loaded)) return undefined
  const memory = loaded.config.memory ?? OmoMemorySettingsSchema.parse({})
  return { runtime: memory.runtime, agents: memory.agents }
}

/** `memory.runtime.max_bytes` for `omo doctor`: the resolved default and every `agents.<id>.runtime` override. */
export type MemoryRuntimeCaps = {
  readonly maxBytes: number
  readonly agents: Readonly<Record<string, number>>
  /** `memory.runtime.discard_unreflected_journals` and its `agents.<id>.runtime` overrides. */
  readonly discardUnreflectedJournals: boolean
  readonly discardAgents: Readonly<Record<string, boolean>>
}

/** Consumed by member access on the bundled task-config runtime (bin/lib/doctor-memory-runtime.js), which knip cannot trace. @public */
export function resolveMemoryRuntimeCaps(input: {
  readonly cwd: string
  readonly env: OmoConfigEnv
}): MemoryRuntimeCaps {
  const memory =
    loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" }).config.memory ??
    OmoMemorySettingsSchema.parse({})
  const agents: Record<string, number> = {}
  const discardAgents: Record<string, boolean> = {}
  for (const [id, override] of Object.entries(memory.agents)) {
    if (override.runtime?.max_bytes !== undefined) agents[id] = override.runtime.max_bytes
    if (override.runtime?.discard_unreflected_journals !== undefined)
      discardAgents[id] = override.runtime.discard_unreflected_journals
  }
  return {
    maxBytes: memory.runtime.max_bytes,
    agents,
    discardUnreflectedJournals: memory.runtime.discard_unreflected_journals,
    discardAgents,
  }
}

export function resolveDaemonTaskSettings(input: {
  readonly cwd: string
  readonly env: OmoConfigEnv
}): DaemonTaskSettings {
  // The same config view the extension's task runner loads (omo-senpi config-resolution: harness "senpi").
  const loaded = loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" })
  // `loaded.config` fills schema defaults, so whether a layer SET a key is read from the loaded layers
  // through the same harness and profile view.
  let merged: Record<string, unknown> = {}
  for (const layer of loaded.layers) merged = mergeOmoConfigRecords(merged, layer.config)
  const view = resolveOmoConfigView({
    config: merged,
    harness: "senpi",
    ...(loaded.profile === undefined ? {} : { profile: loaded.profile }),
  })
  const setTask = view.config["task"]
  if (!isRecord(setTask)) return {}
  const policy = setTask["host_engine_policy"] === undefined ? undefined : loaded.config.task?.host_engine_policy
  const idleExitMs = setTask["host_idle_exit_ms"] === undefined ? undefined : loaded.config.task?.host_idle_exit_ms
  return {
    ...(policy === undefined ? {} : { host_engine_policy: policy }),
    ...(idleExitMs === undefined ? {} : { host_idle_exit_ms: idleExitMs }),
  }
}
