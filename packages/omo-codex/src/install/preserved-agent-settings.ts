import { lstat, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseJsonString } from "./codex-config-toml-sections"
import { resolveManagedAgentReasoning, type PreservedAgentReasoning } from "./managed-agent-reasoning-defaults"

export async function capturePreservedAgentReasoning(input: {
  readonly codexHome: string
}): Promise<ReadonlyMap<string, PreservedAgentReasoning>> {
  const agentsDir = join(input.codexHome, "agents")
  if (!(await exists(agentsDir))) return new Map()

  const preserved = new Map<string, PreservedAgentReasoning>()
  const agentEntries = await readdir(agentsDir, { withFileTypes: true })
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml")) continue
    const content = await readTextIfExists(join(agentsDir, entry.name))
    if (content === null) continue
    const effort = extractReasoningEffort(content)
    if (effort !== null) {
      preserved.set(agentNameFromToml(entry.name), {
        model: extractModel(content),
        effort,
      })
    }
  }
  return preserved
}

export async function capturePreservedAgentServiceTier(input: {
  readonly codexHome: string
}): Promise<ReadonlyMap<string, string | null>> {
  const agentsDir = join(input.codexHome, "agents")
  if (!(await exists(agentsDir))) return new Map()

  const preserved = new Map<string, string | null>()
  const agentEntries = await readdir(agentsDir, { withFileTypes: true })
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml")) continue
    const content = await readTextIfExists(join(agentsDir, entry.name))
    if (content === null) continue
    preserved.set(agentNameFromToml(entry.name), extractServiceTier(content))
  }
  return preserved
}

export async function restorePreservedReasoning(input: {
  readonly agentName: string
  readonly linkPath: string
  readonly target: string
  readonly value: PreservedAgentReasoning | undefined
}): Promise<void> {
  if (input.value === undefined) return
  const content = await readFile(input.target, "utf8")
  const bundledEffort = extractReasoningEffort(content)
  const effort = resolveManagedAgentReasoning({
    agentName: input.agentName,
    bundledModel: extractModel(content),
    bundledEffort,
    preserved: input.value,
  })
  if (bundledEffort === effort) return
  const replacement = replaceTopLevelStringSetting(content, "model_reasoning_effort", effort, { insertIfMissing: false })
  if (!replacement.replaced) return
  await writeFile(input.linkPath, replacement.content)
}

export async function restorePreservedServiceTier(input: {
  readonly linkPath: string
  readonly preserved: boolean
  readonly value: string | null
}): Promise<void> {
  if (!input.preserved) return
  const content = await readFile(input.linkPath, "utf8")
  if (extractServiceTier(content) === input.value) return
  const replacement = replaceTopLevelStringSetting(content, "service_tier", input.value, { insertIfMissing: true })
  if (!replacement.replaced) return
  await writeFile(input.linkPath, replacement.content)
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null
    throw error
  }
}

function extractModel(content: string): string | null {
  return extractTopLevelStringSetting(content, "model")
}

function extractReasoningEffort(content: string): string | null {
  return extractTopLevelStringSetting(content, "model_reasoning_effort")
}

function extractServiceTier(content: string): string | null {
  return extractTopLevelStringSetting(content, "service_tier")
}

function extractTopLevelStringSetting(content: string, key: string): string | null {
  for (const line of content.split(/\n/)) {
    if (isSectionHeader(line)) return null
    const rawValue = topLevelStringSettingRawValue(line, key)
    if (rawValue === undefined) continue
    const parsed = parseJsonString(rawValue)
    if (parsed !== null) return parsed
  }
  return null
}

function replaceTopLevelStringSetting(
  content: string,
  key: string,
  value: string | null,
  options: { readonly insertIfMissing: boolean },
): { readonly content: string; readonly replaced: boolean } {
  const lines = content.split(/\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || isSectionHeader(line)) break
    if (topLevelStringSettingRawValue(line, key) === undefined) continue
    if (value === null) {
      lines.splice(index, 1)
      return { content: lines.join("\n"), replaced: true }
    }
    lines[index] = line.replace(/=\s*"(?:[^"\\]|\\.)*"/, `= ${JSON.stringify(value)}`)
    return { content: lines.join("\n"), replaced: true }
  }

  if (value === null || !options.insertIfMissing) return { content, replaced: false }
  lines.splice(topLevelInsertionIndex(lines), 0, `${key} = ${JSON.stringify(value)}`)
  return { content: lines.join("\n"), replaced: true }
}

function topLevelStringSettingRawValue(line: string, key: string): string | undefined {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*")/)
  if (match === null) return undefined
  const settingKey = match[1]
  const rawValue = match[2]
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
  const trimmed = line.trim()
  return trimmed.startsWith("[") && trimmed.endsWith("]")
}

function agentNameFromToml(fileName: string): string {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw error
    return false
  }
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}
