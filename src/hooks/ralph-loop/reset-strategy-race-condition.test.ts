/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createRalphLoopHook } from "./index"

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolvePromise: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: () => {
      if (resolvePromise) {
        resolvePromise()
      }
    },
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (condition()) {
      return
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }

  throw new Error("Condition was not met in time")
}

describe("ralph-loop reset strategy race condition", () => {
  test("should continue iteration when old session idle arrives before TUI switch completes", async () => {
    // given - reset strategy loop with blocked TUI session switch
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const createSessionCalls: Array<{ parentID?: string }> = []
    let selectSessionCalls = 0
    const selectSessionDeferred = createDeferred()

    const hook = createRalphLoopHook({
      directory: process.cwd(),
      client: {
        session: {
          prompt: async (options: {
            path: { id: string }
            body: { parts: Array<{ type: string; text: string }> }
          }) => {
            promptCalls.push({
              sessionID: options.path.id,
              text: options.body.parts[0].text,
            })
            return {}
          },
          promptAsync: async (options: {
            path: { id: string }
            body: { parts: Array<{ type: string; text: string }> }
          }) => {
            promptCalls.push({
              sessionID: options.path.id,
              text: options.body.parts[0].text,
            })
            return {}
          },
          create: async (options: {
            body: { parentID?: string; title?: string }
            query?: { directory?: string }
          }) => {
            createSessionCalls.push({ parentID: options.body.parentID })
            return { data: { id: `new-session-${createSessionCalls.length}` } }
          },
          messages: async () => ({ data: [] }),
        },
        tui: {
          showToast: async () => ({}),
          selectSession: async () => {
            selectSessionCalls += 1
            await selectSessionDeferred.promise
            return {}
          },
        },
      },
    } as Parameters<typeof createRalphLoopHook>[0])

    hook.startLoop("session-old", "Build feature", { strategy: "reset" })

    // when - first idle is in-flight and old session fires idle again before TUI switch resolves
    const firstIdleEvent = hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-old" } },
    })

    await waitUntil(() => selectSessionCalls > 0)

    const secondIdleEvent = hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-old" } },
    })

    await waitUntil(() => selectSessionCalls > 1)

    selectSessionDeferred.resolve()
    await Promise.all([firstIdleEvent, secondIdleEvent])

    // then - second idle should not be skipped during reset transition
    expect(createSessionCalls.length).toBe(2)
    expect(promptCalls.length).toBe(2)
    expect(hook.getState()?.iteration).toBe(3)
  })
})
