import { createNodeGitExec, type GitExec, type GitMemoryRepo } from "@oh-my-opencode/memory-core"

export const HISTORY_MAX_COMMITS = 500
export const HISTORY_RECENT_DIFFS = 50
export const HISTORY_PER_DIFF_CAP = 100_000
export const HISTORY_TOTAL_PAYLOAD_CAP = 5_000_000
export const REFLECTION_COMMIT_PATTERN = /^(?:feat|fix|chore)\(reflection\)|^merge\(reflection\)/

const RECORD_SEPARATOR = "\u001e"
const GIT_TIMEOUT_MS = 30_000

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

interface CommitMetadata {
  readonly sha: string
  readonly author: string
  readonly date: string
  readonly subject: string
  readonly body: string
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
    const capped = capDiff(diffs.get(record.sha), totalDiffBytes)
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

async function readMetadata(repo: GitMemoryRepo, exec: GitExec): Promise<readonly CommitMetadata[]> {
  const raw = await gitLog(repo, exec, [
    "-n",
    String(HISTORY_MAX_COMMITS),
    "--first-parent",
    `--format=${RECORD_SEPARATOR}%H%x00%an%x00%aI%x00%s%x00%b`,
  ])
  const records: CommitMetadata[] = []
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
