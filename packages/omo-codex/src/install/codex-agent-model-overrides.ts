import {
  resolveModelReferences,
  type OmoAgentDef,
  type OmoConfig,
} from "../../../omo-config-core/src/index"
import {
  getCodexOmoConfig,
  type CodexOmoConfigOptions,
} from "../../plugin/shared/src/config-loader"

const CODEX_REASONING_EFFORTS: Readonly<Record<string, string>> = {
  off: "none",
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
}

export interface CodexAgentModelOverride {
  readonly model?: string
  readonly modelReasoningEffort?: string
  readonly serviceTier?: string
}

export interface CodexAgentModelOverrideResult {
  readonly agents: ReadonlyMap<string, CodexAgentModelOverride>
  readonly warnings: readonly string[]
}

export function getCodexAgentModelOverrides(options: CodexOmoConfigOptions = {}): CodexAgentModelOverrideResult {
  const config = getCodexOmoConfig(options)
  return resolveCodexAgentModelOverrides(
    { agents: config.agents, models: config.models },
    config.warnings,
  )
}

export function resolveCodexAgentModelOverrides(
  view: Pick<OmoConfig, "agents" | "models">,
  initialWarnings: readonly string[] = [],
): CodexAgentModelOverrideResult {
  const resolved = resolveModelReferences({ agents: view.agents, models: view.models })
  const warnings = [
    ...initialWarnings,
    ...resolved.diagnostics.map((diagnostic) => diagnostic.message),
  ]
  const agents = new Map<string, CodexAgentModelOverride>()

  for (const [agentName, definition] of Object.entries(resolved.view.agents ?? {})) {
    const override = resolveAgentOverride(agentName, definition, warnings)
    if (Object.keys(override).length > 0) agents.set(agentName, override)
  }

  return { agents, warnings }
}

export function unknownCodexAgentModelOverrideWarnings(input: {
  readonly configuredAgents: Iterable<string>
  readonly managedAgentNames: ReadonlySet<string>
}): readonly string[] {
  const warnings: string[] = []
  for (const agentName of input.configuredAgents) {
    if (input.managedAgentNames.has(agentName)) continue
    warnings.push(`agents.${agentName} does not match a LazyCodex-managed Codex agent; override skipped`)
  }
  return warnings
}

export function applyCodexAgentModelOverride(content: string, override: CodexAgentModelOverride): string {
  let next = content
  if (override.model !== undefined) next = replaceTopLevelSetting(next, "model", override.model)
  if (override.modelReasoningEffort !== undefined) {
    next = replaceTopLevelSetting(next, "model_reasoning_effort", override.modelReasoningEffort)
  }
  if (override.serviceTier !== undefined) next = replaceTopLevelSetting(next, "service_tier", override.serviceTier)
  return next
}

function resolveAgentOverride(
  agentName: string,
  definition: OmoAgentDef,
  warnings: string[],
): CodexAgentModelOverride {
  const primary = primaryAgentModel(agentName, definition)
  const override: {
    model?: string
    modelReasoningEffort?: string
    serviceTier?: string
  } = {}
  if (primary.model !== undefined) override.model = primary.model

  if (primary.reasoning !== undefined) {
    const effort = CODEX_REASONING_EFFORTS[primary.reasoning.trim().toLowerCase()]
    if (effort === undefined) {
      warnings.push(
        `${primary.reasoningPath} has unsupported Codex effort ${JSON.stringify(primary.reasoning)}; setting skipped`,
      )
    } else {
      override.modelReasoningEffort = effort
    }
  }

  const serviceTier = primary.providerOptions?.["service_tier"]
  if (serviceTier !== undefined) {
    if (typeof serviceTier === "string") override.serviceTier = serviceTier
    else warnings.push(`${primary.providerOptionsPath}.service_tier must be a string; setting skipped`)
  }

  return override
}

function primaryAgentModel(agentName: string, definition: OmoAgentDef): {
  readonly model?: string
  readonly providerOptions?: Readonly<Record<string, unknown>>
  readonly providerOptionsPath: string
  readonly reasoning?: string
  readonly reasoningPath: string
} {
  const agentPath = `agents.${agentName}`
  if (definition.model !== undefined) {
    return {
      model: definition.model,
      providerOptions: definition.provider_options,
      providerOptionsPath: `${agentPath}.provider_options`,
      reasoning: definition.reasoning,
      reasoningPath: `${agentPath}.reasoning`,
    }
  }

  const first = definition.models?.[0]
  if (typeof first === "object") {
    return {
      model: first.model,
      providerOptions: first.provider_options ?? definition.provider_options,
      providerOptionsPath: first.provider_options === undefined
        ? `${agentPath}.provider_options`
        : `${agentPath}.models.0.provider_options`,
      reasoning: first.reasoning ?? definition.reasoning,
      reasoningPath: first.reasoning === undefined
        ? `${agentPath}.reasoning`
        : `${agentPath}.models.0.reasoning`,
    }
  }

  return {
    ...(typeof first === "string" ? { model: first } : {}),
    providerOptions: definition.provider_options,
    providerOptionsPath: `${agentPath}.provider_options`,
    reasoning: definition.reasoning,
    reasoningPath: `${agentPath}.reasoning`,
  }
}

function replaceTopLevelSetting(content: string, key: string, value: string): string {
  const lines = content.split(/\n/)
  const matchingIndexes: number[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || isSectionHeader(line)) break
    if (topLevelSettingKey(line) === key) matchingIndexes.push(index)
  }

  const firstIndex = matchingIndexes[0]
  if (firstIndex === undefined) {
    lines.splice(topLevelInsertionIndex(lines), 0, `${key} = ${JSON.stringify(value)}`)
    return lines.join("\n")
  }

  const indent = lines[firstIndex]?.match(/^\s*/)?.[0] ?? ""
  lines[firstIndex] = `${indent}${key} = ${JSON.stringify(value)}`
  for (let index = matchingIndexes.length - 1; index >= 1; index -= 1) {
    const duplicateIndex = matchingIndexes[index]
    if (duplicateIndex !== undefined) lines.splice(duplicateIndex, 1)
  }
  return lines.join("\n")
}

function topLevelSettingKey(line: string): string | undefined {
  const match = stripTomlLineComment(line).trim().match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=/)
  return match?.[1]
}

function topLevelInsertionIndex(lines: readonly string[]): number {
  const sectionIndex = lines.findIndex((line) => isSectionHeader(line))
  const topLevelEnd = sectionIndex === -1 ? lines.length : sectionIndex
  let insertionIndex = topLevelEnd
  while (insertionIndex > 0 && lines[insertionIndex - 1] === "") insertionIndex -= 1
  return insertionIndex
}

function isSectionHeader(line: string): boolean {
  const trimmed = stripTomlLineComment(line).trim()
  return trimmed.startsWith("[") && trimmed.endsWith("]")
}

function stripTomlLineComment(line: string): string {
  let quote: "'" | '"' | null = null
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (quote === '"') {
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === '"') quote = null
      index += 1
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      index += 1
      continue
    }
    if (char === "#") return line.slice(0, index)
    index += 1
  }
  return line
}
