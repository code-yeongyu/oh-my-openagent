import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  MemoryBlockCache,
  markMemoryBlock,
  replaceMemoryBlock,
  type AgreementItem,
  type ExternalProjectionLimits,
} from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import {
  createProjectionPins,
  renderProjectedChangesLine,
  type ProjectionPinRecord,
  type ProjectionPins,
  type ProjectionRepinReason,
  type ProjectionTurn,
} from "./projection-pin"
import { estimateSystemTokensCached, MEMORY_PRESSURE_SOFT_RATIO } from "./status"

export const MEMORY_PROMPT_TEMPLATE = "omo-senpi:before_agent_start:v3"
export const MEMORY_NOTICE_CUSTOM_TYPE = "omo-memory:notice"
export const MEMORY_NUDGE_METADATA_TOKEN = "user turns since your last memory save"
export const MEMORY_PRESSURE_METADATA_TOKEN = "memory pressure:"
export const MEMORY_SOUL_METADATA_TOKEN = "Soul updated by"
export const MEMORY_AGREEMENT_METADATA_TOKEN = "Agreement NEEDS-HUMAN"

export interface MemoryPromptSession {
  readonly id: string
  /** Messages the branch's latest compaction pushed out of the live context; 0 while nothing compacted. */
  readonly compactedMessageCount: number
  readonly branch: readonly unknown[]
}

export interface MemoryPromptInjectionOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly createRepo?: (context: MemoryIdentityContext) => GitMemoryRepo
  readonly cache?: MemoryBlockCache
  readonly pins?: ProjectionPins
  /** Persists a pin as a session entry so a resumed or restarted session reproduces the same bytes. */
  readonly recordPin?: (record: ProjectionPinRecord) => void
  readonly onRepin?: (sessionId: string, reason: Exclude<ProjectionRepinReason, "first-turn">) => void
  readonly resolveCompileWarnTokens?: (identity: string) => number
  readonly resolveProjectionLimits?: (identity: string) => ExternalProjectionLimits
  readonly resolveNudgeTurns?: (
    repo: GitMemoryRepo,
    sessionId: string,
    identity: string,
  ) => Promise<number | undefined>
  readonly resolveSoulNotice?: (
    repo: GitMemoryRepo,
    sessionId: string,
    identity: string,
  ) => Promise<{ readonly sha: string } | undefined>
  readonly resolveAgreementsNotice?: (
    repo: GitMemoryRepo,
    sessionId: string,
    identity: string,
  ) => Promise<readonly AgreementItem[] | undefined>
  /**
   * A notice input (the nudge count or the soul notice) failed or timed out. The turn goes on without
   * that notice; the failure is reported here, never thrown into the extension (#9667).
   */
  readonly onNoticeInputFailed?: (input: "nudge" | "soul" | "agreements", sessionId: string, error: unknown) => void
}

/**
 * Per-run memory injection. The stable projection composes with the event's systemPrompt (never
 * rebuilds it), while session-volatile recall and maintenance notices return as a late hidden
 * custom message. Unbound/disabled sessions return undefined so the handler chain passes through.
 */
export interface MemoryPromptHandler {
  (payload: unknown, eventCtx?: unknown): Promise<BeforeAgentStartEventResult | undefined>
  /**
   * Compiles the block (and its pressure estimate) a new session's first prompt will need, at HEAD, so the prompt
   * finds it ready: in this process, or persisted for the next. The prompt shares the in-flight compile instead of
   * starting its own, so a prompt that arrives first is never slower than without the prebuild.
   */
  prebuild(context: MemoryIdentityContext): Promise<void>
}

export function createMemoryPromptHandler(options: MemoryPromptInjectionOptions): MemoryPromptHandler {
  const cache = options.cache ?? new MemoryBlockCache()
  const pins = options.pins ?? createProjectionPins()
  const recordPin = options.recordPin ?? (() => undefined)
  const createRepo = options.createRepo ?? defaultCreateRepo
  // The pressure estimate is a pure function of the commit, like the compiled block above it. Without
  // this memo every prompt listed the tree and read every system blob again (one git process each):
  // 45 git spawns between Enter and the provider request in a 2.7k-commit identity.
  const pressureEstimates = new Map<string, number>()
  const pressureInFlight = new Map<string, Promise<number>>()
  // Persisted with the compiled block: a relaunch reads the estimate of a commit instead of listing its tree again.
  // One estimate per revision is in flight at a time, so a prompt and a prebuild share it.
  const estimatePressure = (repo: GitMemoryRepo, revision: string): Promise<number> => {
    const known = pressureEstimates.get(revision)
    if (known !== undefined) return Promise.resolve(known)
    let pending = pressureInFlight.get(revision)
    if (pending === undefined) {
      // estimateSystemTokens throws on a failed read, so a stored estimate is always the commit's own.
      pending = cache.remember(repo, "system-token-estimate", revision, async () =>
        ({ value: String(await estimateSystemTokensCached(repo, revision, pressureEstimates)), persist: true }))
        .then((stored) => {
          const tokens = Number(stored)
          pressureEstimates.set(revision, tokens)
          return tokens
        })
      pressureInFlight.set(revision, pending)
      void pending.finally(() => pressureInFlight.delete(revision)).catch(() => undefined)
    }
    return pending
  }
  async function noticeInput<T>(
    input: "nudge" | "soul" | "agreements",
    sessionId: string,
    read: () => Promise<T | undefined> | undefined,
  ): Promise<T | undefined> {
    try {
      return await read()
    } catch (error) {
      options.onNoticeInputFailed?.(input, sessionId, error)
      return undefined
    }
  }
  const blockOptions = (context: MemoryIdentityContext) => {
    const projection = options.resolveProjectionLimits?.(context.identity)
    return { agentId: context.identity, ...(projection === undefined ? {} : { projection }) }
  }
  const handler = async (payload: unknown, eventCtx?: unknown): Promise<BeforeAgentStartEventResult | undefined> => {
    const preview = isRecord(payload) && payload.preview === true
    const systemPrompt = readSystemPrompt(payload)
    if (systemPrompt === undefined) return undefined
    const session = readPromptSession(eventCtx)
    if (session === undefined) return undefined
    const context = options.resolveContext(session.id)
    if (context === undefined) return undefined

    // One HEAD read per prompt: the nudge count, the soul notice and the pin all ask for it, and each read is
    // a git process (about 10 ms). Each consumer bounds its git ranges by this HEAD, so a commit that lands
    // during the prompt is seen by the next prompt instead of half-seen by this one.
    const repo = withHeadReadOnce(createRepo(context))
    // A preview (senpi's prompt-cache prewarm) keeps only the systemPrompt: compose at the revision the
    // real turn will use, and record no pin, consume no watermark, announce no repin. The notice inputs
    // only feed the message a preview discards, so their reads (a git log each) are skipped too.
    const nudgeTurns = preview
      ? undefined
      : await noticeInput("nudge", session.id, () => options.resolveNudgeTurns?.(repo, session.id, context.identity))
    const soulNotice = preview
      ? undefined
      : await noticeInput("soul", session.id, () => options.resolveSoulNotice?.(repo, session.id, context.identity))
    const flaggedAgreements = preview
      ? undefined
      : await noticeInput("agreements", session.id, () => options.resolveAgreementsNotice?.(repo, session.id, context.identity))
    const pinInput = { repo, sessionId: session.id, branch: session.branch, head: await repo.head() }
    const turn: ProjectionTurn = preview
      ? { revision: await pins.peek(pinInput) }
      : await pins.advance({ ...pinInput, record: recordPin })
    if (turn.repinned !== undefined && turn.repinned !== "first-turn") options.onRepin?.(session.id, turn.repinned)
    const block = await cache.compile(repo, `${MEMORY_PROMPT_TEMPLATE}:${context.identity}`, blockOptions(context), turn.revision)
    const pressureBlock = await addMemoryPressureMetadata(
      block,
      turn.revision,
      options.resolveCompileWarnTokens?.(context.identity),
      (revision) => estimatePressure(repo, revision),
    )
    const notice = renderMemoryNotice(session.compactedMessageCount, nudgeTurns, soulNotice, turn, flaggedAgreements ?? [])
    const nextPrompt = replaceMemoryBlock(systemPrompt, markMemoryBlock(context.identity, pressureBlock))
    if (notice === undefined) return { systemPrompt: nextPrompt }
    return {
      systemPrompt: nextPrompt,
      message: {
        customType: MEMORY_NOTICE_CUSTOM_TYPE,
        content: notice,
        display: false,
      },
    }
  }
  return Object.assign(handler, {
    async prebuild(context: MemoryIdentityContext): Promise<void> {
      const repo = createRepo(context)
      const head = await repo.head()
      if (head === null) return
      await cache.compile(repo, `${MEMORY_PROMPT_TEMPLATE}:${context.identity}`, blockOptions(context), head)
      if (options.resolveCompileWarnTokens?.(context.identity) !== undefined) await estimatePressure(repo, head)
    },
  })
}

async function addMemoryPressureMetadata(
  block: string,
  revision: string | null,
  compileWarnTokens: number | undefined,
  estimate: (revision: string) => Promise<number>,
): Promise<string> {
  if (compileWarnTokens === undefined || revision === null) return block
  const tokens = await estimate(revision)
  const softThreshold = Math.floor(MEMORY_PRESSURE_SOFT_RATIO * compileWarnTokens)
  if (tokens < softThreshold) return block
  const percentage = Math.floor((tokens / compileWarnTokens) * 100)
  const line = `- ${MEMORY_PRESSURE_METADATA_TOKEN} system/ ~${tokens}/${compileWarnTokens} tokens (${percentage}% of advisory); trim or demote stale system/ blocks via the memory tool or run /dream`
  const metadataEnd = block.lastIndexOf("</memory_metadata>")
  if (metadataEnd < 0) return `${block}\n${line}`
  return `${block.slice(0, metadataEnd)}${line}\n${block.slice(metadataEnd)}`
}

/**
 * Session-volatile lines only. Every line is a fact about THIS session's state; standing facts (what
 * memory is, that recall arrives on its own) live in the compiled block. No line means no notice.
 */
function renderMemoryNotice(
  compactedMessageCount: number,
  nudgeTurns: number | undefined,
  soulNotice: { readonly sha: string } | undefined,
  turn: ProjectionTurn,
  flaggedAgreements: readonly AgreementItem[],
): string | undefined {
  const lines = [
    ...(compactedMessageCount === 0
      ? []
      : [`- ${compactedMessageCount} earlier messages were compacted out of the live context; what still matters from them arrives on its own as <recalled-memory> blocks`]),
    ...(nudgeTurns === undefined
      ? []
      : [`- ${nudgeTurns} ${MEMORY_NUDGE_METADATA_TOKEN}. Save durable facts now, or decide nothing qualifies.`]),
    ...(soulNotice === undefined
      ? []
      : [`- ${MEMORY_SOUL_METADATA_TOKEN} reflection ${soulNotice.sha.slice(0, 7)} since your last run`]),
    ...(turn.changes === undefined ? [] : [renderProjectedChangesLine(turn.changes, turn.revision, turn.sources)]),
    ...flaggedAgreements.map((item) =>
      `- ${MEMORY_AGREEMENT_METADATA_TOKEN} (broken x${item.n}): "${item.text}" Do not break it again this session; if the task needs it, stop and ask your person.`),
  ]
  if (lines.length === 0) return undefined
  return ["<memory_notice>", ...lines, "</memory_notice>"].join("\n")
}

function defaultCreateRepo(context: MemoryIdentityContext): GitMemoryRepo {
  return new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity })
}

function readSystemPrompt(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  if (payload.type !== "before_agent_start") return undefined
  return typeof payload.systemPrompt === "string" ? payload.systemPrompt : undefined
}

function readPromptSession(eventCtx: unknown): MemoryPromptSession | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
  if (manager === undefined) return undefined
  const getSessionId = manager.getSessionId
  const getBranch = manager.getBranch
  if (typeof getSessionId !== "function" || typeof getBranch !== "function") return undefined
  const id = Reflect.apply(getSessionId, manager, [])
  const branch = Reflect.apply(getBranch, manager, [])
  if (typeof id !== "string" || id.length === 0 || !Array.isArray(branch)) return undefined
  return { id, compactedMessageCount: countCompactedMessages(branch), branch }
}

/**
 * The branch carries summarized-out entries alongside the live ones, so its length says nothing about
 * what left the context. Senpi's live context starts at the latest compaction's `firstKeptEntryId`;
 * the messages before that entry are the ones the model can no longer see. A branch whose kept id is
 * gone (an older compaction's entries pruned from this path) falls back to the compaction entry.
 */
function countCompactedMessages(branch: readonly unknown[]): number {
  let compactionIndex = -1
  let firstKeptEntryId: string | undefined
  for (const [index, entry] of branch.entries()) {
    if (!isRecord(entry) || entry.type !== "compaction") continue
    compactionIndex = index
    firstKeptEntryId = typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : undefined
  }
  if (compactionIndex < 0) return 0
  const keptIndex = firstKeptEntryId === undefined
    ? -1
    : branch.findIndex((entry) => isRecord(entry) && entry.id === firstKeptEntryId)
  const boundary = keptIndex < 0 ? compactionIndex : keptIndex
  return branch.slice(0, boundary).filter((entry) => isRecord(entry) && entry.type === "message").length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** `repo` with `head()` answered by one shared read; every other member is the repository's own. */
function withHeadReadOnce(repo: GitMemoryRepo): GitMemoryRepo {
  let head: Promise<string | null> | undefined
  return new Proxy(repo, {
    get(target, property, receiver) {
      if (property === "head") {
        return () => (head ??= target.head().catch((error: unknown) => {
          head = undefined
          throw error
        }))
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
