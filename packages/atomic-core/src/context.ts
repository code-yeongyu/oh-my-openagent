import type { OmoAtomicContextSettings } from "@oh-my-opencode/omo-config-core"

import type { AtomicClient } from "./client"
import { requireRepositoryRelativePath } from "./client-runner"
import { AtomicError, type AtomicErrorCode } from "./errors"

export type AtomicContextScope = {
  readonly cwd: string
  /** Canonical repository identity and current view established by the adapter's repository probe. */
  readonly repository: string
  readonly view: string
  readonly needsReindex: boolean
}

export type AtomicContextRequest = {
  readonly scope: AtomicContextScope
  readonly sessionId: string
  readonly intentId?: string
  readonly query?: string
  readonly files?: readonly string[]
  readonly limit?: number
  readonly budgetChars?: number
  readonly signal?: AbortSignal
}

export type AtomicContextReference = {
  /** Untrusted reference material. Adapters must delimit it from instructions when injecting it. */
  readonly reference: string
  readonly stale: boolean
}

export type AtomicContextDiagnostic = AtomicErrorCode | "stale_index" | "empty_context"
export type InvalidateAtomicContext = (repository: string) => void

type ContextOptions = {
  readonly client: Pick<AtomicClient, "vaultContext">
  readonly policy: OmoAtomicContextSettings
  readonly warn: (diagnostic: { readonly sessionId: string; readonly code: AtomicContextDiagnostic }) => void
  readonly now?: () => number
}

type Entry = { readonly reference: string; readonly expires: number }
type Generation = {
  readonly cache: Map<string, Entry>
  readonly pending: Map<string, Promise<string>>
}

function requestedCap(request: number | undefined, cap: number): number {
  if (request === undefined) return cap
  if (!Number.isInteger(request) || request < 1 || request > cap) {
    throw new AtomicError("invalid_input", { operation: "vault context", sideEffectsPossible: false })
  }
  return request
}

/** A cancelled reader never aborts a retrieval shared with another reader. */
function awaitReference(load: Promise<string>, signal: AbortSignal | undefined): Promise<string | undefined> {
  if (signal === undefined) return load
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined)
    signal.addEventListener("abort", abort, { once: true })
    void load.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

export function createAtomicContextService(options: ContextOptions) {
  const { client, policy } = options
  const now = options.now ?? Date.now
  const generations = new Map<string, Generation>()
  const warned = new Map<string, Set<AtomicContextDiagnostic>>()

  function warnOnce(sessionId: string, code: AtomicContextDiagnostic) {
    const codes = warned.get(sessionId) ?? new Set<AtomicContextDiagnostic>()
    if (codes.has(code)) return
    codes.add(code)
    warned.set(sessionId, codes)
    options.warn({ sessionId, code })
  }

  async function retrieve(request: AtomicContextRequest): Promise<AtomicContextReference | undefined> {
    const { scope, sessionId, intentId, signal } = request
    if (signal?.aborted) return undefined
    const query = request.query?.trim().replace(/\s+/g, " ")
    const files = [...new Set((request.files ?? []).map((file) => requireRepositoryRelativePath(file, "vault context")))]
      .sort()
    const limit = requestedCap(request.limit, policy.limit)
    const budgetChars = requestedCap(request.budgetChars, policy.budget_chars)
    const key = JSON.stringify([scope.view, intentId, query || undefined, files, limit, budgetChars])
    const generation = generations.get(scope.repository) ?? { cache: new Map(), pending: new Map() }
    generations.set(scope.repository, generation)
    if (scope.needsReindex) warnOnce(sessionId, "stale_index")
    const time = now()
    for (const [id, entry] of generation.cache) {
      if (entry.expires <= time) generation.cache.delete(id)
    }
    const cached = generation.cache.get(key)
    if (cached !== undefined) return { reference: cached.reference, stale: scope.needsReindex }

    let pending = generation.pending.get(key)
    if (pending === undefined) {
      pending = client.vaultContext({
        cwd: scope.cwd,
        query: query ? [query] : undefined,
        intentId,
        files,
        limit,
        budgetChars,
        timeoutMs: policy.timeout_ms,
      }).then((context) => {
        const reference = context.memories.length === 0 ? "" : context.context_markdown.slice(0, budgetChars).trim()
        if (reference && policy.cache_ttl_ms > 0 && generations.get(scope.repository) === generation) {
          generation.cache.set(key, { reference, expires: now() + policy.cache_ttl_ms })
        }
        return reference
      }).finally(() => generation.pending.delete(key))
      generation.pending.set(key, pending)
    }

    try {
      const reference = await awaitReference(pending, signal)
      if (signal?.aborted || generations.get(scope.repository) !== generation) return undefined
      if (!reference) {
        if (reference === "") warnOnce(sessionId, "empty_context")
        return undefined
      }
      return { reference, stale: scope.needsReindex }
    } catch (error) {
      if (!(error instanceof AtomicError)) throw error
      if (error.code !== "cancelled" && !signal?.aborted) warnOnce(sessionId, error.code)
      return undefined
    }
  }

  return {
    retrieve,
    async inject(request: AtomicContextRequest) {
      if (!policy.enabled) return undefined
      try {
        return await retrieve(request)
      } catch (error) {
        if (!(error instanceof AtomicError)) throw error
        warnOnce(request.sessionId, error.code)
        return undefined
      }
    },
    /** Sync, intent or memory changes, settles, and promotions invalidate all views in this repository. */
    invalidate: (repository: string) => { generations.delete(repository) },
    forgetSession: (sessionId: string) => { warned.delete(sessionId) },
  }
}

export type AtomicContextService = ReturnType<typeof createAtomicContextService>
