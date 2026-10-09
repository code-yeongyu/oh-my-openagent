import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"
import { log } from "../shared/logger"

const AGENT_DIRECTORY = "oh-my-openagent"

/**
 * Stamp written into every agent file this module owns. `writeAgentMarkdown` only ever
 * overwrites files carrying it, so a hand-authored agent (or a config override such as a
 * user-pinned explore.md) is never clobbered — the same "user config wins" outcome the v1
 * plugin surface had.
 */
const GENERATED_MARKER = "generated-by: oh-my-openagent"

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
  // Written FLAT into agents/ so opencode registers each agent under its bare id
  // ("Sisyphus - ultraworker"), exactly like the v1 plugin surface did. The previous
  // layout (agents/oh-my-openagent/<name>.md) made every id "oh-my-openagent/<name>",
  // which broke default_agent, every existing session, and the agent picker.
  return join(getOpenCodeConfigDir({ binary: "opencode" }), "agents")
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

  const lines = ["---", `# ${GENERATED_MARKER}`]
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
    let existing: string | undefined
    try {
      existing = readFileSync(path, "utf8")
    } catch {
      existing = undefined
    }
    if (existing !== undefined && !existing.includes(GENERATED_MARKER)) {
      // A hand-authored agent owns this file; never overwrite it. The v1 surface let the
      // user's config win the same way, and their model pins must survive regressions.
      log("agent file is user-authored; not overwriting", { name, path })
      continue
    }
    const changed = existing === undefined || existing !== markdown
    if (changed) writeFileSync(path, markdown)
    written.push({ name, id: name, path, changed })
  }
  return written
}
