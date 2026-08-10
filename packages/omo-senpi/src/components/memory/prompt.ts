import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  MemoryBlockCache,
  markMemoryBlock,
  replaceMemoryBlock,
} from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"

export const MEMORY_PROMPT_TEMPLATE = "omo-senpi:before_agent_start:v1"

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
  readonly clock?: () => Date
  readonly searchExposure?: () => boolean
}

/**
 * Per-run compiled-memory injection. Transforms ONLY the event's systemPrompt (compose, never
 * rebuild): an earlier extension's chained modifications survive, and our sentinel-delimited
 * block is replaced in place or appended. Unbound/disabled sessions return undefined so the
 * handler chain passes through untouched.
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

    const block = await cache.compile(createRepo(context), `${MEMORY_PROMPT_TEMPLATE}:${context.identity}`, {
      agentId: context.identity,
      conversationId: session.id,
      previousMessageCount: session.priorMessageCount,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    })
    const composed = options.searchExposure?.() === true ? `${block}\n\n${MEMORY_TOOL_DISCOVERY_NOTE}` : block
    return { systemPrompt: replaceMemoryBlock(systemPrompt, markMemoryBlock(context.identity, composed)) }
  }
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
