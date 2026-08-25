import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import { readReflectionHealth } from "./worker/health"

export const MEMORY_STATUS_KEY = "memory"
export const MEMORY_PRESSURE_SOFT_RATIO = 0.8
/** Footer budget: the assembled line drops optional segments right-to-left past this width. */
export const MEMORY_STATUS_MAX_WIDTH = 60
/** A streak at or above this many consecutive failures earns the `!N` badge. */
const STREAK_BADGE_THRESHOLD = 3
/** Shared health history bound so footer and RPC streaks are computed from the same window. */
export const MEMORY_HEALTH_SCAN_LIMIT = 20
const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export interface MemoryStatusUi {
  setStatus(key: string, text: string | undefined): void
  notify(message: string, level: "error" | "warning"): void
}

export interface GitRepoForStatus {
  head(): Promise<string | null>
  headCommitTimestamp(): Promise<number | null>
  lsTree(revision?: string, path?: string): Promise<string[]>
  show(revision: string, path: string): Promise<string>
  status(paths?: readonly string[]): Promise<string>
}

/** The optional footer segments, in render order, as computed before width trimming. */
export interface MemoryStatusSegments {
  readonly dirty: boolean
  readonly backlogSteps: number
  readonly streak: number
}

export interface MemoryStatusResult {
  readonly notified: boolean
  readonly footerShown: boolean
}

export interface RefreshMemoryStatusInput {
  readonly context: MemoryIdentityContext
  readonly ui: MemoryStatusUi
  readonly compileWarnTokens: number
  readonly alreadyNotified: boolean
  readonly gitRepo?: GitRepoForStatus
  readonly now?: () => number
  readonly showFooter?: boolean
  readonly checkAdvisory?: boolean
  /** Starts a spacing-gated background dream when the committed system tree reaches soft pressure. */
  readonly requestPressureDream?: () => void
  /** Bound session whose reflection backlog feeds the ` (+N)` segment; omitted means no backlog. */
  readonly sessionId?: string
}

export async function refreshMemoryStatus(input: RefreshMemoryStatusInput): Promise<MemoryStatusResult> {
  const repo = input.gitRepo ?? createGitRepo(input.context.identityPaths.repo)
  const head = await repo.head()
  if (head === null) return { notified: false, footerShown: false }

  let footerShown = false
  if (input.showFooter !== false) {
    const committedAt = await repo.headCommitTimestamp()
    const age = committedAt === null
      ? null
      : formatRelativeAge(committedAt * SECOND_MS, (input.now ?? Date.now)())
    if (age !== null) {
      const segments = await readMemoryStatusSegments(repo, input.context, input.sessionId)
      input.ui.setStatus(
        MEMORY_STATUS_KEY,
        formatMemoryStatusLine(input.context.identity, age, segments),
      )
      footerShown = true
    }
  }

  if (input.checkAdvisory === false || input.alreadyNotified) return { notified: false, footerShown }

  const estimate = await estimateSystemTokens(repo, head)
  if (estimate >= Math.floor(MEMORY_PRESSURE_SOFT_RATIO * input.compileWarnTokens)) {
    try {
      input.requestPressureDream?.()
    } catch {
      // The advisory must remain available even if pressure-dream scheduling fails synchronously.
    }
  }
  if (estimate < input.compileWarnTokens) return { notified: false, footerShown }

  input.ui.notify(
    `system memory ~${estimate} tokens exceeds advisory ${input.compileWarnTokens}; consider /doctor`,
    "warning",
  )
  return { notified: true, footerShown }
}

/**
 * Collects the footer's optional segments. Every source is best-effort: a footer is decoration,
 * so a broken git call or an unreadable state file degrades to "segment absent", never to a throw.
 */
export async function readMemoryStatusSegments(
  repo: GitRepoForStatus,
  context: MemoryIdentityContext,
  sessionId: string | undefined,
): Promise<MemoryStatusSegments> {
  const [dirty, backlogSteps, streak] = await Promise.all([
    readDirty(repo),
    readBacklogSteps(context, sessionId),
    readStreak(context),
  ])
  return { dirty, backlogSteps, streak }
}

/** Assembles `mem:<identity> <age>[*][ (+N)][ !N]`, dropping segments right-to-left to fit. */
export function formatMemoryStatusLine(
  identity: string,
  age: string,
  segments: MemoryStatusSegments,
): string {
  const base = `mem:${identity} ${age}`
  const optional: string[] = [
    segments.dirty ? "*" : "",
    segments.backlogSteps >= 1 ? ` (+${segments.backlogSteps})` : "",
    segments.streak >= STREAK_BADGE_THRESHOLD ? ` !${segments.streak}` : "",
  ]
  // Drop right-to-left (`!N`, then `(+N)`, then `*`) until the line fits the budget.
  for (let keep = optional.length; keep > 0; keep -= 1) {
    const candidate = base + optional.slice(0, keep).join("")
    if (candidate.length <= MEMORY_STATUS_MAX_WIDTH) return candidate
  }
  return base
}

async function readDirty(repo: GitRepoForStatus): Promise<boolean> {
  try {
    return (await repo.status()).trim().length > 0
  } catch {
    return false
  }
}

async function readBacklogSteps(
  context: MemoryIdentityContext,
  sessionId: string | undefined,
): Promise<number> {
  if (sessionId === undefined || sessionId.length === 0) return 0
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(context.identityPaths.transcripts, sessionId, "state.json"), "utf8"),
    )
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return 0
    const steps = (raw as Record<string, unknown>)["steps_since_last_successful_reflection"]
    return typeof steps === "number" && Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0
  } catch {
    return 0
  }
}

async function readStreak(context: MemoryIdentityContext): Promise<number> {
  try {
    const health = await readReflectionHealth(
      join(context.identityPaths.reflection, "completions"),
      { limit: MEMORY_HEALTH_SCAN_LIMIT },
    )
    return health.streak
  } catch {
    return 0
  }
}

export async function estimateSystemTokens(repo: GitRepoForStatus, head: string): Promise<number> {
  const paths = await repo.lsTree(head)
  const systemMarkdownPaths = paths.filter(isSystemMarkdown)
  if (systemMarkdownPaths.length === 0) return 0
  const contents = await Promise.all(
    systemMarkdownPaths.map((path) => repo.show(head, path)),
  )
  const totalBytes = contents.reduce((sum, content) => sum + Buffer.byteLength(content, "utf8"), 0)
  return Math.floor(totalBytes / 4)
}

function isSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path.endsWith(".md")
}

export function formatRelativeAge(committedAt: number, now: number): string | null {
  const age = now - committedAt
  if (!Number.isFinite(age) || age < 0) return null
  if (age < MINUTE_MS) return "just now"
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)}m ago`
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)}h ago`
  return `${Math.floor(age / DAY_MS)}d ago`
}

function createGitRepo(repoPath: string): GitRepoForStatus {
  const repo = new GitMemoryRepo({ dir: repoPath, agentId: "omo-status" })
  return {
    head: () => repo.head(),
    headCommitTimestamp: () => repo.headCommitTimestamp(),
    lsTree: (revision, path) => repo.lsTree(revision, path),
    show: (revision, path) => repo.show(revision, path),
    status: (paths) => repo.status(paths ?? []),
  }
}
