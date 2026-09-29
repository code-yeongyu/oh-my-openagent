import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"

const AGENT_DIRECTORY = "oh-my-openagent"

export type AgentPermissionEffect = "allow" | "deny" | "ask"

export type AgentPermissionRule = {
  action: string
  resource: string
  effect: AgentPermissionEffect
}

const ACTION_ALIASES: Record<string, string> = {
  bash: "shell",
}

export function agentMarkdownDirectory(override?: string): string {
  if (override) return override
  return join(getOpenCodeConfigDir({ binary: "opencode" }), "agents", AGENT_DIRECTORY)
}

export function agentFileName(name: string): string {
  const cleaned = name.replace(/[\\/]/g, "-").replace(/^\.+/, "").trim()
  return `${cleaned.length > 0 ? cleaned : "agent"}.md`
}

export function nestedAgentID(name: string): string {
  return `${AGENT_DIRECTORY}/${name}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function permissionEffect(value: unknown): AgentPermissionEffect | undefined {
  if (value === "allow" || value === "deny" || value === "ask") return value
  return undefined
}

export function permissionsFromV1(permission: unknown): AgentPermissionRule[] {
  if (!isRecord(permission)) return []
  const rules: AgentPermissionRule[] = []
  for (const [rawAction, value] of Object.entries(permission)) {
    const action = ACTION_ALIASES[rawAction] ?? rawAction
    const effect = permissionEffect(value)
    if (effect) {
      rules.push({ action, resource: "*", effect })
      continue
    }
    if (!isRecord(value)) continue
    for (const [resource, nested] of Object.entries(value)) {
      const nestedEffect = permissionEffect(nested)
      if (!nestedEffect) continue
      rules.push({ action, resource, effect: nestedEffect })
    }
  }
  return rules
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function agentMode(value: unknown): "primary" | "subagent" | "all" | undefined {
  if (value === "primary" || value === "subagent" || value === "all") return value
  return undefined
}

export function renderAgentMarkdown(name: string, config: Record<string, unknown>): string | undefined {
  const prompt = typeof config.prompt === "string"
    ? config.prompt
    : typeof config.system === "string"
      ? config.system
      : undefined
  if (prompt === undefined && typeof config.description !== "string") return undefined

  const lines = ["---"]
  if (typeof config.description === "string") lines.push(`description: ${yamlString(config.description)}`)
  const mode = agentMode(config.mode)
  if (mode) lines.push(`mode: ${mode}`)
  if (typeof config.model === "string" && config.model.length > 0) lines.push(`model: ${yamlString(config.model)}`)
  if (typeof config.color === "string") lines.push(`color: ${yamlString(config.color)}`)
  if (config.hidden === true) lines.push("hidden: true")
  if (typeof config.steps === "number" && Number.isInteger(config.steps) && config.steps > 0) {
    lines.push(`steps: ${config.steps}`)
  }
  const permissions = permissionsFromV1(config.permission ?? config.permissions)
  if (permissions.length > 0) {
    lines.push("permissions:")
    for (const rule of permissions) {
      lines.push(`  - action: ${yamlString(rule.action)}`)
      lines.push(`    resource: ${yamlString(rule.resource)}`)
      lines.push(`    effect: ${rule.effect}`)
    }
  }
  lines.push("---", "", prompt ?? "")
  if (!lines[lines.length - 1]?.endsWith("\n")) lines.push("")
  return `${lines.join("\n")}`
}

export type WrittenAgent = {
  name: string
  id: string
  path: string
  changed: boolean
}

export function writeAgentMarkdown(input: {
  directory: string
  agents: Record<string, unknown>
}): WrittenAgent[] {
  mkdirSync(input.directory, { recursive: true })
  const written: WrittenAgent[] = []
  for (const [name, value] of Object.entries(input.agents)) {
    if (!isRecord(value) || value.disable === true || value.disabled === true) continue
    const markdown = renderAgentMarkdown(name, value)
    if (!markdown) continue
    const path = join(input.directory, agentFileName(name))
    let changed = true
    try {
      changed = readFileSync(path, "utf8") !== markdown
    } catch {
      changed = true
    }
    if (changed) writeFileSync(path, markdown)
    written.push({ name, id: nestedAgentID(name), path, changed })
  }
  return written
}
