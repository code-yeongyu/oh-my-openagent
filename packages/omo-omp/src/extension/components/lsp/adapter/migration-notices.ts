import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

interface LspEntry {
  readonly disabled?: boolean
  readonly command?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
}

interface ConfigJson {
  readonly lsp?: Readonly<Record<string, LspEntry>>
}

export interface ConfigNotice {
  readonly kind: "untrusted_project_lsp_command"
  readonly serverIds: readonly string[]
  readonly configPath: string
  readonly userConfigPath: string
}

export function getConfigNotices(): readonly ConfigNotice[] {
  const paths = getConfigPaths()
  const project = loadJsonFile(paths.project)
  if (!project?.lsp) return []

  const serverIds = Object.entries(project.lsp)
    .filter(([, entry]) => entry.disabled !== true && (entry.command !== undefined || entry.env !== undefined))
    .map(([serverId]) => serverId)

  if (serverIds.length === 0) return []
  return [
    {
      kind: "untrusted_project_lsp_command",
      serverIds,
      configPath: paths.project,
      userConfigPath: paths.user,
    },
  ]
}

function getConfigPaths(): { readonly project: string; readonly user: string } {
  return {
    project: join(process.cwd(), ".pi", "lsp-client.json"),
    user: join(resolve(process.env.HOME?.trim() || homedir()), ".pi", "lsp-client.json"),
  }
}

function loadJsonFile(path: string): ConfigJson | null {
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parseConfigJson(parsed)
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function parseConfigJson(value: unknown): ConfigJson | null {
  if (!isRecord(value)) return null
  const rawLsp = value["lsp"]
  if (rawLsp === undefined) return {}
  if (!isRecord(rawLsp)) return null

  const lsp: Record<string, LspEntry> = {}
  for (const [id, entry] of Object.entries(rawLsp)) {
    const parsed = parseLspEntry(entry)
    if (parsed === null) return null
    lsp[id] = parsed
  }
  return { lsp }
}

function parseLspEntry(value: unknown): LspEntry | null {
  if (!isRecord(value)) return null
  const disabled = value["disabled"]
  const command = value["command"]
  const env = value["env"]
  if (disabled !== undefined && typeof disabled !== "boolean") return null
  if (command !== undefined && !isStringArray(command)) return null
  if (env !== undefined && !isStringRecord(env)) return null
  return {
    ...(disabled !== undefined ? { disabled } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(env !== undefined ? { env } : {}),
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
