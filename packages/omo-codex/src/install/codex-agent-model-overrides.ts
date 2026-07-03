import { lstat, readFile } from "node:fs/promises"
import { join } from "node:path"
import { parseAgentHeaderName, splitTomlSections } from "./codex-config-toml-sections"

const CONFIG_FILE_NAME = "omo.toml"
const SUPPORTED_OVERRIDE_FIELDS = ["model", "model_reasoning_effort", "service_tier"] as const

type SupportedOverrideField = (typeof SUPPORTED_OVERRIDE_FIELDS)[number]

export interface CodexAgentModelOverride {
  readonly model?: string
  readonly modelReasoningEffort?: string
  readonly serviceTier?: string
}

export interface CodexAgentModelOverrideReadResult {
  readonly agents: ReadonlyMap<string, CodexAgentModelOverride>
  readonly configPath: string
  readonly loaded: boolean
  readonly warnings: readonly string[]
}

export async function readCodexAgentModelOverrides(input: {
  readonly codexHome: string
}): Promise<CodexAgentModelOverrideReadResult> {
  const configPath = join(input.codexHome, CONFIG_FILE_NAME)
  const content = await readOverrideConfig(configPath)
  if (content.status === "missing") {
    return {
      agents: new Map(),
      configPath,
      loaded: false,
      warnings: [],
    }
  }
  if (content.status === "unreadable") {
    return {
      agents: new Map(),
      configPath,
      loaded: false,
      warnings: [`${configPath} could not be read: ${content.reason}`],
    }
  }
  const parsed = parseCodexAgentModelOverrides(content.value)
  return {
    agents: parsed.agents,
    configPath,
    loaded: true,
    warnings: parsed.warnings.map((warning) => `${configPath}: ${warning}`),
  }
}

export function parseCodexAgentModelOverrides(content: string): {
  readonly agents: ReadonlyMap<string, CodexAgentModelOverride>
  readonly warnings: readonly string[]
} {
  const agents = new Map<string, CodexAgentModelOverride>()
  const warnings: string[] = []
  for (const section of splitTomlSections(content)) {
    if (section.header === null) continue
    const agentName = parseAgentHeaderName(section.header)
    if (agentName === null) continue
    const parsed = parseAgentOverrideSection(agentName, section.text)
    if (parsed.override !== null) agents.set(agentName, parsed.override)
    warnings.push(...parsed.warnings)
  }
  return { agents, warnings }
}

export function applyCodexAgentModelOverride(content: string, override: CodexAgentModelOverride): string {
  let next = content
  if (override.model !== undefined) {
    next = replaceTopLevelStringSetting(next, "model", override.model)
  }
  if (override.modelReasoningEffort !== undefined) {
    next = replaceTopLevelStringSetting(next, "model_reasoning_effort", override.modelReasoningEffort)
  }
  if (override.serviceTier !== undefined) {
    next = replaceTopLevelStringSetting(next, "service_tier", override.serviceTier)
  }
  return next
}

export function unknownCodexAgentModelOverrideWarnings(input: {
  readonly configuredAgents: Iterable<string>
  readonly knownAgentNames: ReadonlySet<string>
  readonly sourcePath: string
}): readonly string[] {
  const warnings: string[] = []
  for (const agentName of input.configuredAgents) {
    if (input.knownAgentNames.has(agentName)) continue
    warnings.push(
      `${input.sourcePath}: [agents.${agentName}] does not match a LazyCodex-managed Codex agent; override skipped`,
    )
  }
  return warnings
}

function parseAgentOverrideSection(agentName: string, sectionText: string): {
  readonly override: CodexAgentModelOverride | null
  readonly warnings: readonly string[]
} {
  let override: CodexAgentModelOverride = {}
  const warnings: string[] = []
  let hasOverride = false
  for (const rawLine of sectionText.split(/\n/)) {
    const line = stripTomlLineComment(rawLine).trim()
    if (line.length === 0 || line.startsWith("[")) continue
    const setting = parseSetting(line)
    if (setting === null) continue
    if (!isSupportedOverrideField(setting.key)) {
      warnings.push(`[agents.${agentName}].${setting.key} is not supported; override skipped`)
      continue
    }
    const value = parseTomlStringValue(setting.rawValue)
    if (value === null) {
      warnings.push(`[agents.${agentName}].${setting.key} must be a string; override skipped`)
      continue
    }
    override = mergeOverride(override, setting.key, value)
    hasOverride = true
  }
  return { override: hasOverride ? override : null, warnings }
}

function mergeOverride(
  override: CodexAgentModelOverride,
  key: SupportedOverrideField,
  value: string,
): CodexAgentModelOverride {
  if (key === "model") return { ...override, model: value }
  if (key === "model_reasoning_effort") return { ...override, modelReasoningEffort: value }
  return { ...override, serviceTier: value }
}

function parseSetting(line: string): { readonly key: string; readonly rawValue: string } | null {
  const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
  const key = match?.[1]
  const rawValue = match?.[2]
  if (key === undefined || rawValue === undefined) return null
  return { key, rawValue }
}

function isSupportedOverrideField(value: string): value is SupportedOverrideField {
  return SUPPORTED_OVERRIDE_FIELDS.some((field) => field === value)
}

function replaceTopLevelStringSetting(content: string, key: string, value: string): string {
  const lines = content.split(/\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || isSectionHeader(line)) break
    if (topLevelStringSettingRawValue(line, key) === undefined) continue
    lines[index] = line.replace(/=\s*("(?:[^"\\]|\\.)*"|'[^']*')/, `= ${JSON.stringify(value)}`)
    return lines.join("\n")
  }

  lines.splice(topLevelInsertionIndex(lines), 0, `${key} = ${JSON.stringify(value)}`)
  return lines.join("\n")
}

function topLevelStringSettingRawValue(line: string, key: string): string | undefined {
  const match = stripTomlLineComment(line).trim().match(/^([A-Za-z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/)
  const settingKey = match?.[1]
  const rawValue = match?.[2]
  if (settingKey !== key || rawValue === undefined) return undefined
  return rawValue
}

function topLevelInsertionIndex(lines: readonly string[]): number {
  const sectionIndex = lines.findIndex((line) => isSectionHeader(line))
  const topLevelEnd = sectionIndex === -1 ? lines.length : sectionIndex
  let insertionIndex = topLevelEnd
  while (insertionIndex > 0 && lines[insertionIndex - 1] === "") {
    insertionIndex -= 1
  }
  return insertionIndex
}

function isSectionHeader(line: string): boolean {
  const trimmed = stripTomlLineComment(line).trim()
  return trimmed.startsWith("[") && trimmed.endsWith("]")
}

function parseTomlStringValue(rawValue: string): string | null {
  const value = stripTomlLineComment(rawValue).trim()
  const basicString = value.match(/^"(?:[^"\\]|\\.)*"$/)
  if (basicString !== null) return parseJsonString(value)
  const literalString = value.match(/^'([^']*)'$/)
  return literalString?.[1] ?? null
}

function parseJsonString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "string" ? parsed : null
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
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

async function readOverrideConfig(path: string): Promise<
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "missing" }
  | { readonly status: "unreadable"; readonly reason: string }
> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile()) return { status: "unreadable", reason: "path is not a regular file" }
    return { status: "found", value: await readFile(path, "utf8") }
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return { status: "missing" }
    return { status: "unreadable", reason: errorMessage(error) }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}
