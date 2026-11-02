import type { AgentSession } from "@code-yeongyu/senpi"
import type { CreateChildSession } from "@oh-my-opencode/senpi-task"

import { FACTS_OUTPUT_TOKENS, FACTS_REQUEST_LIMIT, factsContextFits, type FactsModelCapacity } from "./facts-oversized-budget"

type GuardedSession = Awaited<ReturnType<CreateChildSession>> & Pick<AgentSession, "agent" | "abortCompaction" | "setAutoCompactionEnabled">

export function createOversizedFactsGuard(input: {
  readonly model: FactsModelCapacity & { readonly provider: string; readonly id: string }
  readonly createSession?: CreateChildSession
  readonly onFailure: (reason: string) => void
}) {
  let failed = false
  let installed = false
  let session: GuardedSession | undefined
  const fail = (reason: string): void => {
    if (failed) return
    failed = true
    input.onFailure(reason)
    session?.abortCompaction()
    void session?.abort().catch((error: unknown) => {
      input.onFailure(`facts child abort failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  const createSession: CreateChildSession = async (options) => {
    const child = input.createSession === undefined
      ? (await (await import("@code-yeongyu/senpi")).createAgentSession(options)).session
      : await input.createSession(options)
    const candidate = child as Partial<GuardedSession>
    if (typeof candidate.agent?.streamFunction !== "function" || typeof candidate.abortCompaction !== "function"
      || typeof candidate.setAutoCompactionEnabled !== "function") {
      child.dispose()
      fail("facts child cannot enforce the oversized-input guards")
      throw new Error("facts child cannot enforce the oversized-input guards")
    }
    session = child as GuardedSession
    session.setAutoCompactionEnabled(false)
    const originalStream = session.agent.streamFunction
    let requests = 0
    session.agent.streamFunction = (model, context, options) => {
      if (failed || model.provider !== input.model.provider || model.id !== input.model.id
        || model.contextWindow < input.model.contextWindow || model.maxTokens < input.model.maxTokens
        || requests >= FACTS_REQUEST_LIMIT || !factsContextFits(context, model)) {
        fail("facts child exceeded its model, request, or complete-context budget")
        throw new Error("facts child exceeded its model, request, or complete-context budget")
      }
      requests += 1
      return originalStream(model, context, {
        ...options,
        maxTokens: Math.min(FACTS_OUTPUT_TOKENS, input.model.maxTokens),
        maxRetries: 0,
      })
    }
    // The first prompt starts inside runner.start(), before the caller receives its handle.
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "compaction_start" || event.type === "resume_context_reduced") {
        fail("facts child attempted to discard complete source context")
      }
      if (event.type === "message_end" && event.message !== null && typeof event.message === "object"
        && "stopReason" in event.message && event.message.stopReason === "length") {
        fail("facts child output was truncated")
      }
    })
    const dispose = child.dispose.bind(child)
    child.dispose = () => {
      unsubscribe()
      if (session !== undefined) session.agent.streamFunction = originalStream
      dispose()
    }
    installed = true
    return child
  }
  return { createSession, fail, succeeded: () => installed && !failed }
}
