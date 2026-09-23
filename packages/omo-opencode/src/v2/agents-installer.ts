import { homedir } from "node:os"
import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { createBuiltinAgents } from "../agents/builtin-agents"

export interface AgentMarkdown {
  filename: string
  content: string
}

export interface InstallAgentsResult {
  written: string[]
}

function readStringField(config: unknown, field: string): string | undefined {
  if (typeof config !== "object" || config === null) return undefined
  const value = (config as Record<string, unknown>)[field]
  return typeof value === "string" ? value : undefined
}

function readPermissionField(config: unknown): Record<string, string> | undefined {
  if (typeof config !== "object" || config === null) return undefined
  if (!("permission" in config)) return undefined
  const value = (config as { permission?: unknown }).permission
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([, entry]) => typeof entry !== "string")) return undefined
  return Object.fromEntries(entries as Array<[string, string]>)
}

// V2 AgentEditor has no add: agents ship as markdown files instead.
// Frontmatter carries description+mode; model/temperature/permissions ride
// along as a trailing comment because the V2 runner does not consume them.
export async function buildAgentMarkdowns(): Promise<AgentMarkdown[]> {
  const agents = await createBuiltinAgents()
  return Object.entries(agents).map(([name, config]) => {
    const description = readStringField(config, "description") ?? `${name} agent`
    const mode = readStringField(config, "mode") ?? "subagent"
    const prompt = readStringField(config, "prompt") ?? ""
    const model = readStringField(config, "model")
    const temperature = typeof (config as { temperature?: unknown }).temperature === "number"
      ? String((config as { temperature?: unknown }).temperature)
      : undefined
    const permission = readPermissionField(config)
    const meta = [
      ...(model === undefined ? [] : [`model=${model}`]),
      ...(temperature === undefined ? [] : [`temperature=${temperature}`]),
      ...(permission === undefined ? [] : [`permissions=${JSON.stringify(permission)}`]),
    ].join(" ")
    const body = meta.length > 0 ? `${prompt}\n\n<!-- omo-v2-agent: ${meta} -->` : prompt
    const content = `---\ndescription: ${JSON.stringify(description)}\nmode: ${JSON.stringify(mode)}\n---\n\n${body}\n`
    return { filename: `${name}.md`, content }
  })
}

export function defaultAgentsDir(): string {
  return join(homedir(), ".config", "opencode", "agents")
}

// Deliberately NOT wired into the CLI install flow: no existing V1 step writes
// agent files (agents arrive via the config hook), so there is no natural hook.
// Call explicitly when V2 file-based installation is wanted.
export async function installAgents(targetDir: string = defaultAgentsDir()): Promise<InstallAgentsResult> {
  const markdowns = await buildAgentMarkdowns()
  await mkdir(targetDir, { recursive: true })
  const written: string[] = []
  for (const markdown of markdowns) {
    const path = join(targetDir, markdown.filename)
    await writeFile(path, markdown.content, "utf-8")
    written.push(path)
  }
  return { written }
}
