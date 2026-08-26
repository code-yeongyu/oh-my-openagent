import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  MemoryBlockCache,
  markMemoryBlock,
  replaceMemoryBlock,
} from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import { estimateSystemTokens, MEMORY_PRESSURE_SOFT_RATIO } from "./status"

export const MEMORY_PROMPT_TEMPLATE = "omo-senpi:before_agent_start:v3"
export const MEMORY_NOTICE_CUSTOM_TYPE = "omo-memory:notice"
export const MEMORY_NUDGE_METADATA_TOKEN = "user turns since your last memory save"
export const MEMORY_PRESSURE_METADATA_TOKEN = "memory pressure:"
export const MEMORY_SOUL_METADATA_TOKEN = "Soul updated by"

// Injected ONLY under the opt-in search exposure: pointing the agent at tool_search while the tools
// are directly registered sent it hunting for a tool that does not exist (session 019fe95c-09d2).
const MEMORY_TOOL_DISCOVERY_NOTE =
  'The memory tools are discoverable through tool_search: run `tool_search("memory")` once to activate them, then use them for every save.'

export interface MemoryPromptSession {
  readonly id: string
  readonly priorMessageCount: number
}

export interface MemoryPromptInjectionOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly createRepo?: (context: MemoryIdentityContext) => GitMemoryRepo
  readonly cache?: MemoryBlockCache
  readonly searchExposure?: () => boolean
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
    )
    const composed = options.searchExposure?.() === true ? `${pressureBlock}\n\n${MEMORY_TOOL_DISCOVERY_NOTE}` : pressureBlock
    return {
      systemPrompt: replaceMemoryBlock(systemPrompt, markMemoryBlock(context.identity, composed)),
      message: {
        customType: MEMORY_NOTICE_CUSTOM_TYPE,
        content: renderMemoryNotice(session.priorMessageCount, nudgeTurns, soulNotice),
        display: false,
      },
    }
  }
}

async function addMemoryPressureMetadata(
  block: string,
  repo: GitMemoryRepo,
  compileWarnTokens: number | undefined,
): Promise<string> {
  if (compileWarnTokens === undefined) return block
  const head = await repo.head()
  if (head === null) return block
  const estimate = await estimateSystemTokens(repo, head)
  const softThreshold = Math.floor(MEMORY_PRESSURE_SOFT_RATIO * compileWarnTokens)
  if (estimate < softThreshold) return block
  const percentage = Math.floor((estimate / compileWarnTokens) * 100)
  const line = `- ${MEMORY_PRESSURE_METADATA_TOKEN} system/ ~${estimate}/${compileWarnTokens} tokens (${percentage}% of advisory); trim or demote stale system/ blocks via the memory tool or run /dream`
  const metadataEnd = block.lastIndexOf("</memory_metadata>")
  if (metadataEnd < 0) return `${block}\n${line}`
  return `${block.slice(0, metadataEnd)}${line}\n${block.slice(metadataEnd)}`
}

function renderMemoryNotice(
  previousMessageCount: number,
  nudgeTurns: number | undefined,
  soulNotice: { readonly sha: string } | undefined,
): string {
  return [
    "<memory_notice>",
    `- ${previousMessageCount} previous messages between you and the user are stored in recall memory`,
    ...(nudgeTurns === undefined
      ? []
      : [`- ${nudgeTurns} ${MEMORY_NUDGE_METADATA_TOKEN}. Save durable facts now, or decide nothing qualifies.`]),
    ...(soulNotice === undefined
      ? []
      : [`- ${MEMORY_SOUL_METADATA_TOKEN} reflection ${soulNotice.sha.slice(0, 7)} since your last run`]),
    "</memory_notice>",
  ].join("\n")
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
  return { id, priorMessageCount: branch.length }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
