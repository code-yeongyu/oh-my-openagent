import { describe, expect, it, mock } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2SessionMessage } from "../context-types"
import { createFakePluginContext } from "../fake-plugin-context"
import { createSessionTracker } from "../session-tracker"
import { startEventBridge } from "./start-event-bridge"

type EventHook = NonNullable<Hooks["event"]>

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("condition was not met in time")
}

function setup(sessionMessages: ReadonlyArray<V2SessionMessage> = []) {
  const fake = createFakePluginContext({ sessionMessages })
  const tracker = createSessionTracker()
  const warn = mock((_message: string) => {})
  const bridge = startEventBridge(fake.context, { tracker, warn, retryDelayMs: 1 })
  const seen: string[] = []
  const handler: EventHook = async ({ event }) => void seen.push(event.type)
  return { fake, tracker, warn, bridge, seen, handler }
}

const started = { type: "session.execution.started", data: { sessionID: "ses_1" } }
const succeeded = { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }

describe("startEventBridge", () => {
  describe("#given a handler", () => {
    it("#when host events arrive #then the handler gets the 1.x events in order and the tracker follows", async () => {
      // given
      const { fake, tracker, bridge, seen, handler } = setup()
      bridge.setHandler(handler)
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.emit(started)
      fake.emit(succeeded)
      await until(() => seen.length === 3)

      // then
      expect(seen).toEqual(["session.status", "session.status", "session.idle"])
      expect(tracker.statuses()).toEqual({})
      bridge.stop()
    })

    it("#when the handler throws #then it is reported and later events are still delivered", async () => {
      // given
      const { fake, warn, bridge } = setup()
      const delivered: string[] = []
      bridge.setHandler(async ({ event }) => {
        delivered.push(event.type)
        if (delivered.length === 1) throw new Error("hook exploded")
      })
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.emit(started)
      fake.emit(succeeded)
      await until(() => delivered.length === 3)

      // then
      expect(warn.mock.calls.some((call) => call[0].includes("hook exploded"))).toBe(true)
      bridge.stop()
    })

    it("#when the handler is slow #then the tracker still updates without waiting for it", async () => {
      // given
      const { fake, tracker, bridge } = setup()
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      bridge.setHandler(async () => gate)
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.emit(started)

      // then
      await until(() => Object.keys(tracker.statuses()).length === 1)
      release()
      bridge.stop()
    })

    it("#when a child session is deleted #then the handler sees the parent it was created under", async () => {
      // given
      const { fake, bridge } = setup()
      const infos: unknown[] = []
      bridge.setHandler(async ({ event }) => {
        if (event.type === "session.deleted") infos.push((event.properties as { info: unknown }).info)
      })
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.emit({ type: "session.created", data: { sessionID: "ses_child", parentID: "ses_parent", projectID: "p", location: { directory: "/w" }, slug: "s", version: "2" } })
      fake.emit({ type: "session.deleted", data: { sessionID: "ses_child" } })
      await until(() => infos.length === 1)

      // then
      expect(infos).toEqual([{ id: "ses_child", parentID: "ses_parent" }])
      bridge.stop()
    })
  })

  describe("#given no handler yet", () => {
    it("#when events arrive #then the tracker learns them and nothing is dispatched", async () => {
      // given
      const { fake, tracker, bridge, seen } = setup()
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.emit(started)
      await until(() => Object.keys(tracker.statuses()).length === 1)

      // then
      expect(seen).toEqual([])
      bridge.stop()
    })
  })

  describe("#given the bridge is stopped", () => {
    it("#when stop is called #then the subscription ends and later events are ignored", async () => {
      // given
      const { fake, tracker, bridge, seen, handler } = setup()
      bridge.setHandler(handler)
      await until(() => fake.activeSubscribers() === 1)

      // when
      bridge.stop()
      await until(() => fake.activeSubscribers() === 0)
      fake.emit(started)
      await new Promise((resolve) => setTimeout(resolve, 20))

      // then
      expect(seen).toEqual([])
      expect(tracker.statuses()).toEqual({})
    })
  })
  describe("#given the host breaks the event stream", () => {
    it("#when the stream throws #then it resubscribes, warns, and later events are still delivered", async () => {
      // given
      const { fake, warn, bridge, seen, handler } = setup()
      bridge.setHandler(handler)
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.failSubscribers(new Error("Expected JSON value"))
      await until(() => warn.mock.calls.length > 0)
      await until(() => fake.activeSubscribers() === 1)
      fake.emit(started)
      await until(() => seen.length === 1)

      // then
      expect(seen).toEqual(["session.status"])
      expect(warn.mock.calls.some((call) => call[0].includes("Expected JSON value"))).toBe(true)
      bridge.stop()
    })

    it("#when the stream ends on its own #then it resubscribes without a warning", async () => {
      // given
      const { fake, warn, bridge, seen, handler } = setup()
      bridge.setHandler(handler)
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.endSubscribers()
      await until(() => fake.activeSubscribers() === 1)
      fake.emit(started)
      await until(() => seen.length === 1)

      // then
      expect(warn).not.toHaveBeenCalled()
      bridge.stop()
    })

    it("#when stop is called while it is waiting to retry #then it never resubscribes", async () => {
      // given
      const { fake, bridge } = setup()
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.failSubscribers(new Error("boom"))
      bridge.stop()
      await new Promise((resolve) => setTimeout(resolve, 30))

      // then
      expect(fake.activeSubscribers()).toBe(0)
    })

    it("#when a busy session finished while the stream was down #then its missed end is delivered after resubscribing", async () => {
      // given
      const finished: V2SessionMessage[] = [
        { type: "user", id: "msg_1", text: "go", time: { created: 1 } },
        { type: "idle", id: "msg_2", outcome: "failed", error: { type: "provider.no-route", message: "Model unavailable" }, time: { created: 2 } },
      ]
      const { fake, tracker, bridge, handler } = setup(finished)
      const seen: string[] = []
      bridge.setHandler(async (input) => {
        await handler(input)
        seen.push(input.event.type)
      })
      await until(() => fake.activeSubscribers() === 1)
      fake.emit(started)
      await until(() => seen.length === 1)

      // when
      fake.failSubscribers(new Error("Expected JSON value"))
      await until(() => seen.length === 4)

      // then
      expect(seen).toEqual(["session.status", "session.error", "session.status", "session.idle"])
      expect(tracker.statuses()).toEqual({})
      bridge.stop()
    })

    it("#when a busy session is still running after the break #then nothing is synthesised for it", async () => {
      // given
      const running: V2SessionMessage[] = [{ type: "user", id: "msg_1", text: "go", time: { created: 1 } }]
      const { fake, tracker, bridge, seen, handler } = setup(running)
      bridge.setHandler(handler)
      await until(() => fake.activeSubscribers() === 1)
      fake.emit(started)
      await until(() => seen.length === 1)

      // when
      fake.failSubscribers(new Error("boom"))
      await until(() => fake.activeSubscribers() === 1)
      await new Promise((resolve) => setTimeout(resolve, 20))

      // then
      expect(seen).toEqual(["session.status"])
      expect(tracker.statuses()).toEqual({ ses_1: { type: "busy" } })
      bridge.stop()
    })
  })
})
