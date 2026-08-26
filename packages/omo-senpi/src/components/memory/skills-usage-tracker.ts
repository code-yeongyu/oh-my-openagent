import { relative, resolve, sep } from "node:path"

import type { ComponentLogger } from "../../extension/types"
import {
  createSkillsUsageLockRecord,
  incrementSkillsUsageBatch,
  type SkillsUsageLedgerPath,
} from "./skills-usage-ledger"

const DEBOUNCE_MS = 500

/**
 * Extracts the skill id from a file path that targets `<memfs repo>/skills/<name>/**`.
 * Returns undefined when the path does not resolve inside the skills directory.
 */
export function extractSkillId(repoDir: string, rawPath: string): string | undefined {
  if (rawPath.length === 0 || rawPath.includes("\0")) return undefined
  const absolute = resolve(rawPath)
  const rel = relative(repoDir, absolute)
  if (rel.startsWith("..")) return undefined
  const segments = rel.split(sep)
  if (segments.length < 2 || segments[0] !== "skills") return undefined
  return segments[1]
}

/** Debounces skill reads and persists each pending batch under the ledger lock. */
export class SkillsUsageTracker {
  private readonly paths: SkillsUsageLedgerPath
  private readonly repoDir: string
  private readonly now: () => Date
  private readonly logger?: ComponentLogger
  private pending = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushPromise: Promise<void> | undefined

  constructor(options: {
    readonly paths: SkillsUsageLedgerPath
    readonly repoDir: string
    readonly now?: () => Date
    readonly logger?: ComponentLogger
  }) {
    this.paths = options.paths
    this.repoDir = options.repoDir
    this.now = options.now ?? (() => new Date())
    this.logger = options.logger
  }

  /** Records a skill-file read. Paths outside the repo's skills directory are ignored. */
  recordRead(rawPath: string): void {
    const skillId = extractSkillId(this.repoDir, rawPath)
    if (skillId === undefined) return
    this.pending.set(skillId, (this.pending.get(skillId) ?? 0) + 1)
    this.scheduleFlush()
  }

  /** Flushes pending increments immediately. Never throws. */
  async flush(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return
    if (this.flushPromise !== undefined) return this.flushPromise
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.pending.size === 0) return
    const batch = new Map(this.pending)
    this.pending.clear()
    this.flushPromise = this.flushBatch(batch, signal).finally(() => {
      this.flushPromise = undefined
    })
    return this.flushPromise
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, DEBOUNCE_MS)
  }

  private async flushBatch(batch: ReadonlyMap<string, number>, signal?: AbortSignal): Promise<void> {
    const isAborted = (): boolean => signal?.aborted === true
    if (isAborted()) return
    const record = await createSkillsUsageLockRecord()
    if (isAborted()) return
    try {
      await incrementSkillsUsageBatch(this.paths, batch, this.now, record, signal)
    } catch (error) {
      this.logger?.warn("skills-usage ledger flush failed", { error: String(error) })
    }
  }
}
