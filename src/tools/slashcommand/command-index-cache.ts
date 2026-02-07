import { promises as fs } from "node:fs"
import { join, basename } from "node:path"
import { getOmoOpenCodeCacheDir } from "../../shared/data-path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared/claude-config-dir"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import type { CommandFrontmatter } from "../../features/claude-code-command-loader/types"
import type { LazyContentLoader } from "../../features/opencode-skill-loader/types"
import type { CommandInfo, CommandMetadata, CommandScope } from "./types"

const COMMAND_INDEX_CACHE_FILE = "commands-index-v1.json"

export interface CommandIndexEntry {
  name: string
  scope: CommandScope
  path: string
  metadata: CommandMetadata
}

export interface CommandIndexCacheV1 {
  version: 1
  updatedAt: string
  commands: CommandIndexEntry[]
}

export interface CacheReadResult<T> {
  cache: T
  stale: boolean
}

function getCacheFilePath(): string {
  return join(getOmoOpenCodeCacheDir(), COMMAND_INDEX_CACHE_FILE)
}

async function ensureCacheDir(): Promise<void> {
  const dir = getOmoOpenCodeCacheDir()
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
}

function isStale(updatedAtIso: string, ttlMs: number): boolean {
  const updatedAt = Date.parse(updatedAtIso)
  if (!Number.isFinite(updatedAt)) return true
  return Date.now() - updatedAt > ttlMs
}

export async function readCommandIndexCache(options?: {
  ttlMs?: number
}): Promise<CacheReadResult<CommandIndexCacheV1> | null> {
  const cacheFile = getCacheFilePath()
  try {
    const content = await fs.readFile(cacheFile, "utf-8")
    const parsed = JSON.parse(content) as CommandIndexCacheV1
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.commands)) {
      return null
    }
    const ttlMs = options?.ttlMs
    const stale = ttlMs ? isStale(parsed.updatedAt, ttlMs) : false
    return { cache: parsed, stale }
  } catch {
    return null
  }
}

export async function writeCommandIndexCache(commands: CommandIndexEntry[]): Promise<void> {
  await ensureCacheDir()
  const cacheFile = getCacheFilePath()

  const payload: CommandIndexCacheV1 = {
    version: 1,
    updatedAt: new Date().toISOString(),
    commands,
  }

  await fs.writeFile(cacheFile, JSON.stringify(payload, null, 2), "utf-8").catch(
    () => {},
  )
}

function createCommandLazyContentLoader(commandPath: string): LazyContentLoader {
  const loader: LazyContentLoader = {
    loaded: false,
    content: undefined,
    load: async () => {
      if (loader.loaded && loader.content !== undefined) return loader.content
      try {
        const raw = await fs.readFile(commandPath, "utf-8")
        const { body } = parseFrontmatter<CommandFrontmatter>(raw)
        loader.loaded = true
        loader.content = body
        return body
      } catch {
        loader.loaded = true
        loader.content = ""
        return ""
      }
    },
  }
  return loader
}

export function commandIndexToCommandInfos(entries: CommandIndexEntry[]): CommandInfo[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    metadata: e.metadata,
    content: "",
    scope: e.scope,
    lazyContentLoader: createCommandLazyContentLoader(e.path),
  }))
}

async function discoverCommandsFromDir(
  commandsDir: string,
  scope: CommandScope,
): Promise<CommandIndexEntry[]> {
  const entries = await fs.readdir(commandsDir, { withFileTypes: true }).catch(
    () => [],
  )

  const commands: CommandIndexEntry[] = []
  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const commandName = basename(entry.name, ".md")

    try {
      const raw = await fs.readFile(commandPath, "utf-8")
      const { data } = parseFrontmatter<CommandFrontmatter>(raw)
      const isOpencodeSource = scope === "opencode" || scope === "opencode-project"

      const metadata: CommandMetadata = {
        name: commandName,
        description: data.description || "",
        argumentHint: data["argument-hint"],
        model: sanitizeModelField(data.model, isOpencodeSource ? "opencode" : "claude-code"),
        agent: data.agent,
        subtask: Boolean(data.subtask),
      }

      commands.push({
        name: commandName,
        scope,
        path: commandPath,
        metadata,
      })
    } catch {
      // ignore individual parse failures
      continue
    }
  }
  return commands
}

let refreshPromise: Promise<void> | null = null

export function refreshCommandIndexCacheInBackground(options?: {
  ttlMs?: number
  delayMs?: number
}): void {
  if (refreshPromise) return
  const delayMs = options?.delayMs ?? 0

  refreshPromise = (async () => {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }

    const existing = await readCommandIndexCache({ ttlMs: options?.ttlMs })
    if (existing && !existing.stale) return

    const configDir = getOpenCodeConfigDir({ binary: "opencode" })
    const userCommandsDir = join(getClaudeConfigDir(), "commands")
    const projectCommandsDir = join(process.cwd(), ".claude", "commands")
    const opencodeGlobalDir = join(configDir, "command")
    const opencodeProjectDir = join(process.cwd(), ".opencode", "command")

    const [userCommands, opencodeGlobalCommands, projectCommands, opencodeProjectCommands] =
      await Promise.all([
        discoverCommandsFromDir(userCommandsDir, "user"),
        discoverCommandsFromDir(opencodeGlobalDir, "opencode"),
        discoverCommandsFromDir(projectCommandsDir, "project"),
        discoverCommandsFromDir(opencodeProjectDir, "opencode-project"),
      ])

    const all = [
      ...opencodeProjectCommands,
      ...projectCommands,
      ...opencodeGlobalCommands,
      ...userCommands,
    ]

    await writeCommandIndexCache(all)
  })()
    .catch(() => {})
    .finally(() => {
      refreshPromise = null
    })
}
