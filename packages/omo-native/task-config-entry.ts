/**
 * The task-config runtime `omo daemon` loads from the staged payload (`plugin/runtime/task-config/index.js`,
 * bundled by script/build-omo-native.ts). The launcher is plain JS and cannot load TypeScript sources, so
 * this bundle is how it reads its `task.*` settings through the one loader every other `task.*` key goes
 * through (omo-config-core: ~/.omo/omo.jsonc or ~/.omo/omo.json plus project `.omo` layers, JSONC),
 * instead of a copy of the file lookup, the parse or the precedence.
 */

import { loadOmoConfig, mergeOmoConfigRecords, resolveModelReferences, resolveOmoConfigView, type OmoConfigEnv, type OmoModelProfile } from "@oh-my-opencode/omo-config-core"

/** The `task.*` keys `omo daemon` reads. Each is present only when a loaded layer sets it, so the caller can
 * tell "configured" from the schema default. */
export type DaemonTaskSettings = {
  readonly host_engine_policy?: "upgrade" | "fallback"
  readonly host_idle_exit_ms?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function resolveDaemonTaskSettings(input: { readonly cwd: string; readonly env: OmoConfigEnv }): DaemonTaskSettings {
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

/**
 * The `model_profile` and `model_profiles` an `omo thread create` with no model resolves from (#9425):
 * the same senpi-harness view the extension's session-start component reads (omo-senpi config-resolution),
 * with model references expanded. The thread SDK bundle carries no config loader, so the CLI passes this in.
 */
export function resolveThreadModelProfile(input: { readonly cwd: string; readonly env: OmoConfigEnv }): { readonly model_profile?: string; readonly model_profiles?: Readonly<Record<string, OmoModelProfile>> } {
  const view = resolveModelReferences(loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" }).config).view
  return {
    ...(view.model_profile === undefined ? {} : { model_profile: view.model_profile }),
    ...(view.model_profiles === undefined ? {} : { model_profiles: view.model_profiles }),
  }
}
