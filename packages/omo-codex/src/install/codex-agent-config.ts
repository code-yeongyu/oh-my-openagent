import {
  loadOmoConfig,
  mergeOmoConfigRecords,
  OmoAgentDefSchema,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
} from "../../../omo-config-core/src"
import { splitReasoningSuffix } from "../../../omo-config-core/src/schema/reasoning-vocabulary"
import { isPlainRecord } from "./codex-cache-fs"

export interface CodexAgentOverride {
  readonly model?: string
  readonly reasoningEffort?: string
}

export interface CodexAgentConfig {
  readonly defaultRoleEnabled: boolean
  readonly agentOverrides: ReadonlyMap<string, CodexAgentOverride>
  readonly warnings: readonly string[]
}

export function readCodexAgentConfig(options: Omit<LoadOmoConfigOptions, "harness"> = {}): CodexAgentConfig {
  const result = loadOmoConfig({ ...options, harness: "codex" })
  const overrides = readAgentOverrides(result)
  return {
    defaultRoleEnabled: result.config.agents?.default?.disable !== true,
    agentOverrides: overrides.agentOverrides,
    warnings: [...result.diagnostics.map((diagnostic) => diagnostic.message), ...overrides.warnings],
  }
}

export function unmanagedAgentOverrideWarnings(
  agentOverrides: ReadonlyMap<string, CodexAgentOverride>,
  managedAgentNames: ReadonlySet<string>,
): readonly string[] {
  return [...agentOverrides.keys()]
    .filter((name) => !managedAgentNames.has(name))
    .map((name) => `[codex].agents.${name} does not name a LazyCodex-managed agent role; its model override was not applied`)
}

// Only the [codex] block may steer Codex roles: shared base `agents` carry OpenCode model ids
// (librarian/metis/momus share names) that would break a Codex agent TOML.
function readAgentOverrides(result: LoadOmoConfigResult): {
  readonly agentOverrides: ReadonlyMap<string, CodexAgentOverride>
  readonly warnings: readonly string[]
} {
  let merged: Record<string, unknown> = {}
  for (const layer of result.layers) merged = mergeOmoConfigRecords(merged, layer.config)
  const profile = result.profile === undefined ? undefined : recordAt(recordAt(merged, "profiles"), result.profile)
  let agents: Record<string, unknown> = {}
  for (const scope of [merged, profile]) {
    agents = mergeOmoConfigRecords(agents, recordAt(recordAt(scope, "[codex]"), "agents") ?? {})
  }

  const agentOverrides = new Map<string, CodexAgentOverride>()
  const warnings: string[] = []
  for (const [name, value] of Object.entries(agents)) {
    if (name === "default") continue
    const parsed = OmoAgentDefSchema.safeParse(value)
    if (!parsed.success) {
      warnings.push(`[codex].agents.${name} is invalid and was ignored: ${parsed.error.issues[0]?.message ?? "unknown error"}`)
      continue
    }
    const override = toCodexAgentOverride(parsed.data.model, parsed.data.reasoning)
    if (override.model !== undefined || override.reasoningEffort !== undefined) agentOverrides.set(name, override)
  }
  return { agentOverrides, warnings }
}

function toCodexAgentOverride(model: string | undefined, reasoning: string | undefined): CodexAgentOverride {
  const split = model === undefined ? undefined : splitReasoningSuffix(model)
  const effort = codexReasoningEffort(reasoning ?? split?.level)
  return {
    ...(split === undefined || split.base === "" ? {} : { model: split.base }),
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  }
}

function codexReasoningEffort(reasoning: string | undefined): string | undefined {
  if (reasoning === undefined || reasoning === "auto") return undefined
  return reasoning === "off" ? "none" : reasoning
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined
  const child = value[key]
  return isPlainRecord(child) ? child : undefined
}
