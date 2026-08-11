// Palace data collectors: committed HEAD tree + working-tree deltas + git history + reflection state.
// Every collector is read-only; the palace never mutates the memory repository.

import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import {
  createNodeGitExec,
  parseMemoryFile,
  type GitExec,
  type GitMemoryRepo,
  type MemoryIdentityPaths,
  type ReflectionTranscriptState,
} from "@oh-my-opencode/memory-core"

export const HISTORY_MAX_COMMITS = 500
export const HISTORY_RECENT_DIFFS = 50
export const HISTORY_PER_DIFF_CAP = 100_000
export const HISTORY_TOTAL_PAYLOAD_CAP = 5_000_000
export const UNCOMMITTED_LABEL = "uncommitted - not active in system prompt"
export const REFLECTION_COMMIT_PATTERN = /^(?:feat|fix|chore)\(reflection\)|^merge\(reflection\)/

const RECORD_SEPARATOR = "\u001e"
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

export interface PalaceCommit {
  readonly sha: string
  readonly shortSha: string
  readonly author: string
  readonly date: string
  readonly subject: string
  readonly body: string
  readonly isReflection: boolean
  readonly diff?: string
  readonly diffTruncated: boolean
}

export interface PalaceHistoryCaps {
  readonly maxCommits: number
  readonly perDiffBytes: number
  readonly totalDiffBytes: number
}

export interface PalaceHistory {
  readonly commits: readonly PalaceCommit[]
  readonly caps: PalaceHistoryCaps
}

export interface PalaceReflectionOutcome {
  readonly runId: string
  readonly outcome: string
  readonly finishedAt: string
}

export interface PalaceReflection {
  readonly cursor?: ReflectionTranscriptState
  readonly conversationId?: string
  readonly outcomes: readonly PalaceReflectionOutcome[]
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
      // Binary payloads are NEVER inlined: name + size only.
      ...(measured.binary || measured.text === undefined ? {} : { body: measured.text }),
    })
  }
  return entries
}

export async function collectHistory(
  repo: GitMemoryRepo,
  exec: GitExec = createNodeGitExec(),
): Promise<PalaceHistory> {
  const caps: PalaceHistoryCaps = {
    maxCommits: HISTORY_MAX_COMMITS,
    perDiffBytes: HISTORY_PER_DIFF_CAP,
    totalDiffBytes: HISTORY_TOTAL_PAYLOAD_CAP,
  }
  const [metadata, diffs] = await Promise.all([readMetadata(repo, exec), readDiffs(repo, exec)])

  let totalDiffBytes = 0
  const commits = metadata.map((record) => {
    const raw = diffs.get(record.sha)
    const capped = capDiff(raw, totalDiffBytes)
    totalDiffBytes += capped.diff?.length ?? 0
    return {
      sha: record.sha,
      shortSha: record.sha.slice(0, 7),
      author: record.author,
      date: record.date,
      subject: record.subject,
      body: record.body,
      isReflection: REFLECTION_COMMIT_PATTERN.test(record.subject),
      diffTruncated: capped.truncated,
      ...(capped.diff === undefined ? {} : { diff: capped.diff }),
    }
  })
  return { commits, caps }
}

export async function collectReflection(
  paths: MemoryIdentityPaths,
  options: { readonly limit: number },
): Promise<PalaceReflection> {
  const [cursor, outcomes] = await Promise.all([
    readLatestCursor(paths.transcripts),
    readOutcomes(join(paths.reflection, "completions"), options.limit),
  ])
  return {
    outcomes,
    ...(cursor === undefined ? {} : { cursor: cursor.state, conversationId: cursor.conversationId }),
  }
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

/**
 * Sizes an entry without ever materialising binary content: committed blobs are measured with
 * `git cat-file -s`, working-tree files with stat. Text bodies are decoded only when the entry is
 * confirmed to be text.
 */
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

async function readMetadata(
  repo: GitMemoryRepo,
  exec: GitExec,
): Promise<
  ReadonlyArray<{ sha: string; author: string; date: string; subject: string; body: string }>
> {
  const raw = await gitLog(repo, exec, [
    "-n",
    String(HISTORY_MAX_COMMITS),
    "--first-parent",
    `--format=${RECORD_SEPARATOR}%H%x00%an%x00%aI%x00%s%x00%b`,
  ])
  const records: Array<{ sha: string; author: string; date: string; subject: string; body: string }> = []
  for (const record of raw.split(RECORD_SEPARATOR)) {
    if (record.trim().length === 0) continue
    const fields = record.replace(/^\n+/, "").split("\0")
    const [sha, author, date, subject, ...rest] = fields
    if (sha === undefined || author === undefined || date === undefined || subject === undefined) continue
    if (!/^[0-9a-f]{40}$/i.test(sha.trim())) continue
    records.push({
      sha: sha.trim(),
      author: author.trim(),
      date: date.trim(),
      subject: subject.trim(),
      body: rest.join("\0").trim(),
    })
  }
  return records
}

async function readDiffs(repo: GitMemoryRepo, exec: GitExec): Promise<ReadonlyMap<string, string>> {
  const raw = await gitLog(repo, exec, [
    "-n",
    String(HISTORY_RECENT_DIFFS),
    "--first-parent",
    `--format=${RECORD_SEPARATOR}%H`,
    "-p",
  ])
  const diffs = new Map<string, string>()
  for (const chunk of raw.split(RECORD_SEPARATOR)) {
    if (chunk.trim().length === 0) continue
    const normalized = chunk.replace(/^\n+/, "")
    const newline = normalized.indexOf("\n")
    if (newline === -1) continue
    const sha = normalized.slice(0, newline).trim()
    if (!/^[0-9a-f]{40}$/i.test(sha)) continue
    diffs.set(sha, normalized.slice(newline + 1))
  }
  return diffs
}

async function gitLog(repo: GitMemoryRepo, exec: GitExec, argv: readonly string[]): Promise<string> {
  const result = await exec
    .run(["log", ...argv], {
      cwd: repo.dir,
      timeoutMs: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    .catch(() => undefined)
  return result?.code === 0 ? result.stdout : ""
}

function capDiff(
  diff: string | undefined,
  totalSoFar: number,
): { readonly diff?: string; readonly truncated: boolean } {
  if (diff === undefined) return { truncated: false }
  let capped = diff
  let truncated = false
  if (capped.length > HISTORY_PER_DIFF_CAP) {
    capped = `${capped.slice(0, HISTORY_PER_DIFF_CAP)}\n\n[diff truncated - exceeded ${Math.round(HISTORY_PER_DIFF_CAP / 1024)}KB]`
    truncated = true
  }
  if (totalSoFar + capped.length > HISTORY_TOTAL_PAYLOAD_CAP) return { truncated: true }
  return { diff: capped, truncated }
}

async function readLatestCursor(
  transcriptsDir: string,
): Promise<{ readonly conversationId: string; readonly state: ReflectionTranscriptState } | undefined> {
  const conversations = await readdir(transcriptsDir, { withFileTypes: true }).catch(() => [])
  let latest: { conversationId: string; state: ReflectionTranscriptState; modifiedAt: number } | undefined
  for (const entry of conversations) {
    if (!entry.isDirectory()) continue
    const statePath = join(transcriptsDir, entry.name, "state.json")
    const parsed = await readJson(statePath)
    if (!isReflectionState(parsed)) continue
    const modifiedAt = await stat(statePath).then((info) => info.mtimeMs).catch(() => 0)
    if (latest === undefined || modifiedAt > latest.modifiedAt) {
      latest = { conversationId: entry.name, state: parsed, modifiedAt }
    }
  }
  if (latest === undefined) return undefined
  return { conversationId: latest.conversationId, state: latest.state }
}

async function readOutcomes(
  completionsDir: string,
  limit: number,
): Promise<readonly PalaceReflectionOutcome[]> {
  const files = await readdir(completionsDir).catch(() => [])
  const outcomes: PalaceReflectionOutcome[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const parsed = await readJson(join(completionsDir, file))
    if (!isRecord(parsed)) continue
    const runId = typeof parsed.runId === "string" ? parsed.runId : file.replace(/\.json$/, "")
    const outcome = typeof parsed.outcome === "string" ? parsed.outcome : "unknown"
    const finishedAt = typeof parsed.finishedAt === "string" ? parsed.finishedAt : ""
    outcomes.push({ runId, outcome, finishedAt })
  }
  return outcomes
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
    .slice(0, Math.max(0, limit))
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isReflectionState(value: unknown): value is ReflectionTranscriptState {
  return (
    isRecord(value) &&
    typeof value.total_completed_steps === "number" &&
    typeof value.reflected_completed_steps === "number"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
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
