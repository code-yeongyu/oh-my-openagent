import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  MemoryBlockCache,
  markMemoryBlock,
  replaceMemoryBlock,
} from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import { estimateSystemTokensCached, MEMORY_PRESSURE_SOFT_RATIO } from "./status"

export const MEMORY_PROMPT_TEMPLATE = "omo-senpi:before_agent_start:v3"
export const MEMORY_NOTICE_CUSTOM_TYPE = "omo-memory:notice"
export const MEMORY_NUDGE_METADATA_TOKEN = "user turns since your last memory save"
export const MEMORY_PRESSURE_METADATA_TOKEN = "memory pressure:"
export const MEMORY_SOUL_METADATA_TOKEN = "Soul updated by"

export interface MemoryPromptSession {
  readonly id: string
  /** Messages the branch's latest compaction pushed out of the live context; 0 while nothing compacted. */
  readonly compactedMessageCount: number
}

export interface MemoryPromptInjectionOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly createRepo?: (context: MemoryIdentityContext) => GitMemoryRepo
  readonly cache?: MemoryBlockCache
  readonly resolveCompileWarnTokens?: (identity: string) => number
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
}

/**
 * Per-run memory injection. The stable projection composes with the event's systemPrompt (never
 * rebuilds it), while session-volatile recall and maintenance notices return as a late hidden
 * custom message. Unbound/disabled sessions return undefined so the handler chain passes through.
 */
export function createMemoryPromptHandler(
  options: MemoryPromptInjectionOptions,
): (payload: unknown, eventCtx?: unknown) => Promise<BeforeAgentStartEventResult | undefined> {
  const cache = options.cache ?? new MemoryBlockCache()
  const createRepo = options.createRepo ?? defaultCreateRepo
  // The pressure estimate is a pure function of the commit, like the compiled block above it. Without
  // this memo every prompt listed the tree and read every system blob again (one git process each):
  // 45 git spawns between Enter and the provider request in a 2.7k-commit identity.
  const pressureEstimates = new Map<string, number>()
  return async (payload, eventCtx) => {
    const systemPrompt = readSystemPrompt(payload)
    if (systemPrompt === undefined) return undefined
    const session = readPromptSession(eventCtx)
    if (session === undefined) return undefined
    const context = options.resolveContext(session.id)
    if (context === undefined) return undefined

    const repo = createRepo(context)
    const nudgeTurns = await options.resolveNudgeTurns?.(repo, session.id, context.identity)
    const soulNotice = await options.resolveSoulNotice?.(repo, session.id, context.identity)
    const block = await cache.compile(repo, `${MEMORY_PROMPT_TEMPLATE}:${context.identity}`, {
      agentId: context.identity,
    })
    const pressureBlock = await addMemoryPressureMetadata(
      block,
      repo,
      options.resolveCompileWarnTokens?.(context.identity),
      pressureEstimates,
    )
    const notice = renderMemoryNotice(session.compactedMessageCount, nudgeTurns, soulNotice)
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
}

async function addMemoryPressureMetadata(
  block: string,
  repo: GitMemoryRepo,
  compileWarnTokens: number | undefined,
  estimates: Map<string, number>,
): Promise<string> {
  if (compileWarnTokens === undefined) return block
  const head = await repo.head()
  if (head === null) return block
  const estimate = await estimateSystemTokensCached(repo, head, estimates)
  const softThreshold = Math.floor(MEMORY_PRESSURE_SOFT_RATIO * compileWarnTokens)
  if (estimate < softThreshold) return block
  const percentage = Math.floor((estimate / compileWarnTokens) * 100)
  const line = `- ${MEMORY_PRESSURE_METADATA_TOKEN} system/ ~${estimate}/${compileWarnTokens} tokens (${percentage}% of advisory); trim or demote stale system/ blocks via the memory tool or run /dream`
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
  return { id, compactedMessageCount: countCompactedMessages(branch) }
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
