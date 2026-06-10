import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"

type PendingParentWakeForTest = {
  readonly notifications: readonly string[]
}

function createPluginInput(client: unknown): PluginInput {
  const directory = tmpdir()
  return unsafeTestValue<PluginInput>({
    project: {
      id: "test-project",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {},
    client,
  })
}

function getDispatchedParentWakes(manager: BackgroundManager): Map<string, PendingParentWakeForTest> {
  return unsafeTestValue<{
    readonly parentWakeNotifier: {
      readonly getDispatchedParentWakes: () => Map<string, PendingParentWakeForTest>
    }
  }>(manager).parentWakeNotifier.getDispatchedParentWakes()
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, PendingParentWakeForTest> {
  return unsafeTestValue<{
    readonly parentWakeNotifier: {
      readonly getPendingParentWakes: () => Map<string, PendingParentWakeForTest>
    }
  }>(manager).parentWakeNotifier.getPendingParentWakes()
}

function getObservedOutputSessions(manager: BackgroundManager): Set<string> {
  return unsafeTestValue<{ readonly observedOutputSessions: Set<string> }>(manager).observedOutputSessions
}

async function dispatchParentWake(manager: BackgroundManager, sessionID: string): Promise<void> {
  const internals = unsafeTestValue<{
    readonly queuePendingParentWake: (
      sessionID: string,
      notification: string,
      promptContext: Record<string, unknown>,
      shouldReply: boolean,
      delayMs?: number,
    ) => void
    readonly flushPendingParentWake: (sessionID: string) => Promise<void>
  }>(manager)
  internals.queuePendingParentWake(
    sessionID,
    "<system-reminder>done</system-reminder>",
    { agent: "sisyphus" },
    true,
    0,
  )
  await internals.flushPendingParentWake(sessionID)
}

describe("BackgroundManager parent-wake part event regression", () => {
  test("keeps a dispatched wake when message.part.updated is only the injected internal user wake", async () => {
    // given
    const manager = new BackgroundManager({
      pluginContext: createPluginInput({
        session: {
          status: async () => ({ data: { "parent-session-user-part-update": { type: "idle" } } }),
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
          abort: async () => ({}),
        },
      }),
    })

    try {
      await dispatchParentWake(manager, "parent-session-user-part-update")

      // when
      manager.handleEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "parent-session-user-part-update",
          role: "user",
          part: {
            type: "text",
            text: "done\n<!-- OMO_INTERNAL_INITIATOR -->",
          },
        },
      })

      // then
      expect(getDispatchedParentWakes(manager).has("parent-session-user-part-update")).toBe(true)
      expect(getObservedOutputSessions(manager).has("parent-session-user-part-update")).toBe(false)
    } finally {
      manager.shutdown()
    }
  })

  test("keeps a dispatched wake when message.part.delta is only the injected internal user wake", async () => {
    // given
    const manager = new BackgroundManager({
      pluginContext: createPluginInput({
        session: {
          status: async () => ({ data: { "parent-session-user-part-delta": { type: "idle" } } }),
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
          abort: async () => ({}),
        },
      }),
    })

    try {
      await dispatchParentWake(manager, "parent-session-user-part-delta")

      // when
      manager.handleEvent({
        type: "message.part.delta",
        properties: {
          sessionID: "parent-session-user-part-delta",
          role: "user",
          field: "text",
          delta: "done\n<!-- OMO_INTERNAL_INITIATOR -->",
        },
      })

      // then
      expect(getDispatchedParentWakes(manager).has("parent-session-user-part-delta")).toBe(true)
      expect(getObservedOutputSessions(manager).has("parent-session-user-part-delta")).toBe(false)
    } finally {
      manager.shutdown()
    }
  })

  test("keeps a dispatched wake when an internal user delta arrives before the marker chunk", async () => {
    // given
    const manager = new BackgroundManager({
      pluginContext: createPluginInput({
        session: {
          status: async () => ({ data: { "parent-session-user-part-delta-split": { type: "idle" } } }),
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
          abort: async () => ({}),
        },
      }),
    })

    try {
      await dispatchParentWake(manager, "parent-session-user-part-delta-split")

      // when
      manager.handleEvent({
        type: "message.part.delta",
        properties: {
          sessionID: "parent-session-user-part-delta-split",
          role: "user",
          field: "text",
          delta: "done",
        },
      })

      const requeued = await unsafeTestValue<{
        readonly parentWakeNotifier: {
          readonly requeueDispatchedParentWake: (sessionID: string, reason: string) => Promise<boolean>
        }
      }>(manager).parentWakeNotifier.requeueDispatchedParentWake(
        "parent-session-user-part-delta-split",
        "late session.error",
      )

      // then
      expect(requeued).toBe(true)
      expect(getDispatchedParentWakes(manager).has("parent-session-user-part-delta-split")).toBe(false)
      expect(getObservedOutputSessions(manager).has("parent-session-user-part-delta-split")).toBe(false)
      expect(getPendingParentWakes(manager).get("parent-session-user-part-delta-split")?.notifications).toEqual([
        "<system-reminder>done</system-reminder>",
      ])
    } finally {
      manager.shutdown()
    }
  })
})
