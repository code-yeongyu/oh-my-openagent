import { homedir } from "node:os"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml, stringify as toYaml } from "yaml"
import type { Plugin } from "@opencode/plugin"
import { createBuiltinAgents } from "./agents/builtin-agents"
import type { OhMyOpenCodeConfig } from "./config"
import { applyToolConfig } from "./plugin-handlers/tool-config-handler"
import { log } from "./shared"

const MANAGED_MARKER = "# managed by oh-my-openagent v2 port"
const FRONTMATTER_KEYS = ["description", "mode", "model", "temperature", "top_p", "color", "permission"] as const

export function globalAgentsDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(base, "opencode", "agents")
}

export function renderAgentMarkdown(config: Record<string, unknown>): string {
  const frontmatter: Record<string, unknown> = {}
  for (const key of FRONTMATTER_KEYS) {
    if (config[key] !== undefined) frontmatter[key] = config[key]
  }
  if (typeof config.maxSteps === "number") frontmatter.steps = config.maxSteps
  const prompt = typeof config.prompt === "string" ? config.prompt : ""
  return `---\n${MANAGED_MARKER}\n${toYaml(frontmatter)}---\n${prompt}\n`
}

function isManagedAgentFile(path: string): boolean {
  let content: string | undefined
  try {
    content = readFileSync(path, "utf8")
  } catch {
    return false
  }
  if (!content.startsWith("---\n")) return false
  const end = content.indexOf("\n---", 4)
  if (end === -1) return false
  return content.slice(0, end).includes(MANAGED_MARKER)
}

function writeManagedFile(path: string, content: string): void {
  let existing: string | undefined
  try {
    existing = readFileSync(path, "utf8")
  } catch {
    existing = undefined
  }
  if (existing === content) return
  writeFileSync(path, content)
}

export function disabledAgentMarkdown(): string {
  return `---\n${MANAGED_MARKER}\ndisable: true\n---\n`
}

export async function registerAgentsV2(
  ctx: Plugin.Context,
  pluginConfig: OhMyOpenCodeConfig,
): Promise<void> {
  const fallback = await ctx.model.default().catch(() => undefined)
  const fallbackModel = fallback?.data
  const systemDefaultModel = fallbackModel
    ? `${String(fallbackModel.providerID)}/${String(fallbackModel.id)}`
    : undefined
  const directory = ctx.location.directory
  const agents = await createBuiltinAgents(
    pluginConfig.disabled_agents ?? [],
    pluginConfig.agents,
    directory,
    systemDefaultModel,
    pluginConfig.categories,
  )
  applyToolConfig({ config: {}, pluginConfig, agentResult: agents as Record<string, unknown> })

  const dir = globalAgentsDir()
  mkdirSync(dir, { recursive: true })
  const written = new Set<string>()
  for (const [name, config] of Object.entries(agents)) {
    const path = join(dir, `${name}.md`)
    writeManagedFile(path, renderAgentMarkdown(config as Record<string, unknown>))
    written.add(`${name}.md`)
  }
  // Disabled agents stay alive as stale files unless neutralized; only touch
  // files this port manages.
  for (const disabled of pluginConfig.disabled_agents ?? []) {
    const path = join(dir, `${disabled}.md`)
    if (written.has(`${disabled}.md`) || !isManagedAgentFile(path)) continue
    writeManagedFile(path, disabledAgentMarkdown())
  }

  log("[v2-agents] materialized agents", { count: written.size, directory: dir })
}

export function parseAgentFrontmatter(content: string): Record<string, unknown> {
  const end = content.indexOf("\n---", 4)
  const block = content.slice(4, end)
  return parseYaml(block) as Record<string, unknown>
}
