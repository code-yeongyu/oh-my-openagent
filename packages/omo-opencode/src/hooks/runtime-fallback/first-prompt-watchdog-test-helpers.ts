import type { AutoRetryHelpers } from "./auto-retry"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

export const WATCHDOG_MS = 100
export const SAFE_WAIT_BEFORE_FIRE_MS = 40
export const SAFE_WAIT_AFTER_FIRE_MS = 250
export const AGENT = "sisyphus-junior"
export const PRIMARY_MODEL = "openai/gpt-5.4-mini"
export const FALLBACK_MODEL = "anthropic/claude-haiku-4-5"
export const PLUGIN_CONFIG_WITH_FALLBACK = {
  git_master: {
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  },
  agents: {
    [AGENT]: {
      model: PRIMARY_MODEL,
      fallback_models: [{ model: FALLBACK_MODEL }],
    },
  },
}

export type FakeTimers = {
  advanceBy: (ms: number) => Promise<void>
  restore: () => void
}

export interface RecordedCalls {
  abort: Array<{ sessionID: string; source: string }>
  autoRetry: Array<{ sessionID: string; newModel: string; resolvedAgent: string | undefined; source: string }>
}

export function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalDateNow = Date.now
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void | Promise<void>>()
  const dueTimes = new Map<ReturnType<typeof setTimeout>, number>()
  let now = Date.now()

  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof handler !== "function") {
      throw new Error("String timer handlers are not supported in tests")
    }

    const timer = originalSetTimeout(() => {}, 0)
    originalClearTimeout(timer)
    callbacks.set(timer, () => handler(...args))
    dueTimes.set(timer, now + Math.max(0, delay ?? 0))
    return timer
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>): void => {
    callbacks.delete(timer)
    dueTimes.delete(timer)
  }) as typeof clearTimeout
  Date.now = () => now

  return {
    async advanceBy(ms) {
      const target = now + ms
      while (true) {
        const nextTimer = [...dueTimes.entries()]
          .filter(([, dueAt]) => dueAt <= target)
          .sort((left, right) => left[1] - right[1])[0]?.[0]
        if (!nextTimer) break
        now = dueTimes.get(nextTimer) ?? now
        const callback = callbacks.get(nextTimer)
        callbacks.delete(nextTimer)
        dueTimes.delete(nextTimer)
        await callback?.()
        await flushMicrotasks()
      }
      now = target
      await flushMicrotasks()
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      Date.now = originalDateNow
    },
  }
}

export function createDeps(pluginConfig: HookDeps["pluginConfig"] = undefined): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

export function createHelpers(calls: RecordedCalls, resolvedAgentName?: string): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string, source: string) => {
      calls.abort.push({ sessionID, source })
      return true
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID, newModel, resolvedAgent, source) => {
      calls.autoRetry.push({ sessionID, newModel, resolvedAgent, source })
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => resolvedAgentName,
    cleanupStaleSessions: () => {},
  }
}

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}
