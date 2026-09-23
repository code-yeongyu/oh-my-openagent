export type OpenVikingOperation = "profile" | "recall" | "capture" | "commit"

export type OpenVikingCall = {
  readonly operation: OpenVikingOperation
  readonly sessionId: string
  readonly content?: string
}

export interface OpenVikingTransport {
  (call: OpenVikingCall): Promise<{ readonly context?: string }>
}

export interface OpenVikingLifecycleOptions {
  readonly threshold: number
  readonly transport: OpenVikingTransport
}

type PendingCall = {
  readonly call: OpenVikingCall
  readonly attempts: number
  readonly onSuccess?: (result: { readonly context?: string }) => void | Promise<void>
}

type SessionState = {
  captures: number
  committedAt: number
  readonly eventIds: Set<string>
}

export interface OpenVikingLifecycle {
  start(sessionId: string): Promise<string | undefined>
  recall(sessionId: string, query: string): Promise<string | undefined>
  capture(sessionId: string, role: "user" | "assistant", content: string, eventId?: string): Promise<void>
  compact(sessionId: string): Promise<void>
  shutdown(sessionId: string): Promise<void>
  flushRetries(): Promise<void>
}

export function createOpenVikingLifecycle(options: OpenVikingLifecycleOptions): OpenVikingLifecycle {
  const sessions = new Map<string, SessionState>()
  const pending: PendingCall[] = []

  function state(sessionId: string): SessionState {
    const current = sessions.get(sessionId)
    if (current !== undefined) return current
    const created = { captures: 0, committedAt: 0, eventIds: new Set<string>() }
    sessions.set(sessionId, created)
    return created
  }

  async function invoke(
    call: OpenVikingCall,
    attempts = 0,
    onSuccess?: (result: { readonly context?: string }) => void | Promise<void>,
  ): Promise<{ readonly context?: string } | undefined> {
    try {
      const result = await options.transport(call)
      await onSuccess?.(result)
      return result
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error
      if (attempts < 2) pending.push({ call, attempts: attempts + 1, ...(onSuccess === undefined ? {} : { onSuccess }) })
      return undefined
    }
  }

  async function commit(sessionId: string, force = false): Promise<void> {
    const current = state(sessionId)
    if (!force && current.captures === current.committedAt) return
    const captureCount = current.captures
    await invoke({ operation: "commit", sessionId }, 0, () => {
      current.committedAt = Math.max(current.committedAt, captureCount)
    })
  }

  return {
    async start(sessionId: string): Promise<string | undefined> {
      state(sessionId)
      const profile = (await invoke({ operation: "profile", sessionId }))?.context
      const recalled = (await invoke({ operation: "recall", sessionId }))?.context
      const context = [profile, recalled].filter((value): value is string => value !== undefined && value.length > 0)
      return context.length === 0 ? undefined : context.join("\n\n")
    },

    async recall(sessionId: string, query: string): Promise<string | undefined> {
      state(sessionId)
      return (await invoke({ operation: "recall", sessionId, content: query }))?.context
    },

    async capture(sessionId: string, role: "user" | "assistant", content: string, eventId?: string): Promise<void> {
      if (role !== "assistant") return
      const current = state(sessionId)
      if (eventId !== undefined) {
        if (current.eventIds.has(eventId)) return
        current.eventIds.add(eventId)
      }
      await invoke({ operation: "capture", sessionId, content }, 0, async () => {
        current.captures += 1
        if (current.captures - current.committedAt >= options.threshold) await commit(sessionId)
      })
    },

    async compact(sessionId: string): Promise<void> {
      await commit(sessionId, true)
    },

    async shutdown(sessionId: string): Promise<void> {
      await commit(sessionId)
      sessions.delete(sessionId)
    },

    async flushRetries(): Promise<void> {
      const retries = pending.splice(0)
      for (const retry of retries) await invoke(retry.call, retry.attempts, retry.onSuccess)
    },
  }
}
