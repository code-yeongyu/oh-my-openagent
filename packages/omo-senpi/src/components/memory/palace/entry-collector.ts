import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"

import {
  createNodeGitExec,
  parseMemoryFile,
  type GitExec,
  type GitMemoryRepo,
} from "@oh-my-opencode/memory-core"

export const UNCOMMITTED_LABEL = "uncommitted - not active in system prompt"

const GIT_TIMEOUT_MS = 30_000
const MEMORY_DIR_TOKEN = "$MEMORY_DIR"
const SYSTEM_PREFIX = "system/"
const SKILLS_PREFIX = "skills/"

export type PalaceEntryState = "committed" | typeof UNCOMMITTED_LABEL

export interface PalaceCoreEntry {
  readonly path: string
  readonly projection: string
  readonly description: string
  readonly body: string
  readonly state: PalaceEntryState
}

export interface PalaceExternalEntry {
  readonly path: string
  readonly binary: boolean
  readonly byteSize: number
  readonly state: PalaceEntryState
  readonly body?: string
}

export async function collectCore(
  repo: GitMemoryRepo,
  head: string | null,
): Promise<readonly PalaceCoreEntry[]> {
  const committed = head === null ? [] : (await repo.lsTree(head)).filter(isSystemMarkdown)
  const dirty = await dirtyPaths(repo)
  const paths = unique([...committed, ...[...dirty].filter(isSystemMarkdown)])
  const entries: PalaceCoreEntry[] = []
  for (const path of paths.sort()) {
    const state = dirty.has(path) || head === null ? UNCOMMITTED_LABEL : "committed"
    const raw = await readEntryText(repo, head, path, state)
    if (raw === undefined) continue
    const parsed = parseMemoryFile(raw)
    entries.push({
      path,
      projection: `${MEMORY_DIR_TOKEN}/${path}`,
      description: parsed.frontmatter.description,
      body: parsed.body,
      state,
    })
  }
  return entries
}

export async function collectExternal(
  repo: GitMemoryRepo,
  head: string | null,
  exec: GitExec = createNodeGitExec(),
): Promise<readonly PalaceExternalEntry[]> {
  const committed = head === null ? [] : (await repo.lsTree(head)).filter(isExternal)
  const dirty = await dirtyPaths(repo)
  const paths = unique([...committed, ...[...dirty].filter(isExternal)])
  const entries: PalaceExternalEntry[] = []
  for (const path of paths.sort()) {
    const state = dirty.has(path) || head === null ? UNCOMMITTED_LABEL : "committed"
    const measured = await measureEntry(repo, exec, head, path, state)
    if (measured === undefined) continue
    entries.push({
      path,
      binary: measured.binary,
      byteSize: measured.byteSize,
      state,
      ...(measured.binary || measured.text === undefined ? {} : { body: measured.text }),
    })
  }
  return entries
}

async function readEntryText(
  repo: GitMemoryRepo,
  head: string | null,
  path: string,
  state: PalaceEntryState,
): Promise<string | undefined> {
  if (state === UNCOMMITTED_LABEL) {
    return readFile(join(repo.dir, path), "utf8").catch(() => undefined)
  }
  if (head === null) return undefined
  return repo.show(head, path).catch(() => undefined)
}

async function measureEntry(
  repo: GitMemoryRepo,
  exec: GitExec,
  head: string | null,
  path: string,
  state: PalaceEntryState,
): Promise<{ readonly binary: boolean; readonly byteSize: number; readonly text?: string } | undefined> {
  if (state === UNCOMMITTED_LABEL) {
    const info = await stat(join(repo.dir, path)).catch(() => undefined)
    if (info === undefined || !info.isFile()) return undefined
    const text = await readFile(join(repo.dir, path), "utf8").catch(() => undefined)
    return decide(info.size, text)
  }
  if (head === null) return undefined
  const size = await blobSize(repo, exec, `${head}:${path}`)
  if (size === undefined) return undefined
  const text = await repo.show(head, path).catch(() => undefined)
  return decide(size, text)
}

function decide(
  byteSize: number,
  text: string | undefined,
): { readonly binary: boolean; readonly byteSize: number; readonly text?: string } {
  const binary = text === undefined || isBinaryText(text) || Buffer.byteLength(text, "utf8") !== byteSize
  return binary ? { binary: true, byteSize } : { binary: false, byteSize, text }
}

async function blobSize(repo: GitMemoryRepo, exec: GitExec, revision: string): Promise<number | undefined> {
  const result = await exec
    .run(["cat-file", "-s", revision], {
      cwd: repo.dir,
      timeoutMs: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    .catch(() => undefined)
  if (result === undefined || result.code !== 0) return undefined
  const size = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(size) ? size : undefined
}

async function dirtyPaths(repo: GitMemoryRepo): Promise<ReadonlySet<string>> {
  const porcelain = await repo.status().catch(() => "")
  const paths = new Set<string>()
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const path = line.slice(3).trim().replace(/^"(.*)"$/, "$1")
    if (path.length > 0) paths.add(path)
  }
  return paths
}

function isSystemMarkdown(path: string): boolean {
  return path.startsWith(SYSTEM_PREFIX) && path.endsWith(".md")
}

function isExternal(path: string): boolean {
  return !path.startsWith(SYSTEM_PREFIX) && !path.startsWith(SKILLS_PREFIX)
}

function isBinaryText(text: string): boolean {
  const probe = text.slice(0, 8_000)
  return probe.includes("\u0000") || probe.includes("\uFFFD")
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}
