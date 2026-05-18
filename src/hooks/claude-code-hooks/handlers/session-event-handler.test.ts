import { describe, expect, test } from "bun:test"

import { ContextCollector } from "../../../features/context-injector"
import { cacheToolInput, getToolInput, stopToolInputCacheCleanup } from "../tool-input-cache"
import { buildTranscriptFromSession, hasTranscriptCacheEntry } from "../transcript"
import { createSessionEventHandler, disposeSessionEventHandler } from "./session-event-handler"

function createMockClient() {
  return {
    session: {
      get: async () => ({ data: {} }),
      prompt: async () => undefined,
      messages: async () => ({ data: [] }),
    },
  }
}

describe("createSessionEventHandler", () => {
  test("#given deleted session with retained caches #when session deleted arrives #then per-session resources are cleared", async () => {
    //#given
    const collector = new ContextCollector()
    collector.register("ses_cleanup", {
      id: "hook-context",
      source: "custom",
      content: "pending hook context",
    })
    cacheToolInput("ses_cleanup", "Read", "call-1", { path: "/tmp/a" })
    await buildTranscriptFromSession(createMockClient(), "ses_cleanup", "/tmp", "Read", { path: "/tmp/a" })
    const handler = createSessionEventHandler(createMockClient() as never, {}, collector)

    //#when
    await handler({
      event: { type: "session.deleted", properties: { info: { id: "ses_cleanup" } } },
    })

    //#then
    expect(collector.hasPending("ses_cleanup")).toBe(false)
    expect(getToolInput("ses_cleanup", "Read", "call-1")).toBeNull()
    expect(hasTranscriptCacheEntry("ses_cleanup")).toBe(false)
  })

  test("#given active singleton state #when dispose runs #then all shared caches are cleared", async () => {
    //#given
    const collector = new ContextCollector()
    collector.register("ses_one", {
      id: "ctx-1",
      source: "custom",
      content: "one",
    })
    collector.register("ses_two", {
      id: "ctx-2",
      source: "custom",
      content: "two",
    })
    cacheToolInput("ses_one", "Read", "call-1", { path: "/tmp/one" })
    cacheToolInput("ses_two", "Read", "call-2", { path: "/tmp/two" })
    await buildTranscriptFromSession(createMockClient(), "ses_one", "/tmp", "Read", { path: "/tmp/one" })
    await buildTranscriptFromSession(createMockClient(), "ses_two", "/tmp", "Read", { path: "/tmp/two" })

    //#when
    disposeSessionEventHandler(collector)

    //#then
    expect(collector.hasPending("ses_one")).toBe(false)
    expect(collector.hasPending("ses_two")).toBe(false)
    expect(getToolInput("ses_one", "Read", "call-1")).toBeNull()
    expect(getToolInput("ses_two", "Read", "call-2")).toBeNull()
    expect(hasTranscriptCacheEntry("ses_one")).toBe(false)
    expect(hasTranscriptCacheEntry("ses_two")).toBe(false)

    stopToolInputCacheCleanup()
  })

  test("#given repeated idle events for one session #when stop hook preparation runs #then parent session lookup is reused", async () => {
    //#given
    let getCallCount = 0
    const handler = createSessionEventHandler(
      {
        client: {
          session: {
            get: async () => {
              getCallCount += 1
              return { data: { parentID: "ses_parent" } }
            },
            prompt: async () => undefined,
            messages: async () => ({ data: [] }),
          },
        },
      } as never,
      {},
    )

    //#when
    await handler({
      event: { type: "session.idle", properties: { sessionID: "ses_reuse" } },
    })
    await handler({
      event: { type: "session.idle", properties: { sessionID: "ses_reuse" } },
    })

    //#then
    expect(getCallCount).toBe(1)
  })

  test("#given deleted session #when it idles again #then parent session lookup is fetched again", async () => {
    //#given
    let getCallCount = 0
    const handler = createSessionEventHandler(
      {
        client: {
          session: {
            get: async () => {
              getCallCount += 1
              return { data: { parentID: "ses_parent" } }
            },
            prompt: async () => undefined,
            messages: async () => ({ data: [] }),
          },
        },
      } as never,
      {},
    )

    await handler({
      event: { type: "session.idle", properties: { sessionID: "ses_reset" } },
    })
    await handler({
      event: { type: "session.deleted", properties: { info: { id: "ses_reset" } } },
    })

    //#when
    await handler({
      event: { type: "session.idle", properties: { sessionID: "ses_reset" } },
    })

    //#then
    expect(getCallCount).toBe(2)
  })
})
