/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import * as sessionState from "../../features/claude-code-session-state"
import { _resetForTesting } from "../../features/claude-code-session-state"
import { ContextCollector } from "../../features/context-injector"
import * as sharedModule from "../../shared"
import { createKeywordDetectorHook } from "./index"

type ToastOptions = { body: { title: string } }

function createMockPluginInput(): PluginInput {
  const client = {} as PluginInput["client"]
  Object.assign(client, { tui: { showToast: async () => {} } })

  return {
    client,
    project: {
      id: "dedup-test-project",
      worktree: "/tmp/dedup-test",
      time: { created: 0 },
    },
    directory: "/tmp/dedup-test",
    worktree: "/tmp/dedup-test",
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

describe("keyword-detector deduplication", () => {
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logSpy = spyOn(sharedModule, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy?.mockRestore()
    _resetForTesting()
  })

  describe("#given undo + resend scenario", () => {
    test("#when same keyword detected twice in same session, #then second injection is skipped", async () => {
      // given
      const collector = new ContextCollector()
      const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
      const sessionID = "dedup-session-1"

      const makeOutput = () => ({
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: "ultrawork do something" }],
      })

      // when - first call injects
      const output1 = makeOutput()
      await hook["chat.message"]({ sessionID }, output1)

      // then - first call should inject
      expect(output1.parts[0].text).toContain("---")
      expect(output1.parts[0].text).toContain("do something")

      // when - second call (undo + resend) with same session
      const output2 = makeOutput()
      await hook["chat.message"]({ sessionID }, output2)

      // then - second call should NOT inject (text unchanged)
      expect(output2.parts[0].text).toBe("ultrawork do something")
    })

    test("#when different keywords detected in same session, #then only new keywords are injected", async () => {
      // given
      const collector = new ContextCollector()
      const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
      const sessionID = "dedup-session-2"

      // when - first message triggers ultrawork
      const output1 = {
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: "ultrawork do something" }],
      }
      await hook["chat.message"]({ sessionID }, output1)

      // then - ultrawork injected
      expect(output1.parts[0].text).toContain("---")

      // when - second message triggers search (different keyword, same session)
      const output2 = {
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: "search for react hooks" }],
      }
      await hook["chat.message"]({ sessionID }, output2)

      // then - search should be injected (it's a new keyword type)
      expect(output2.parts[0].text).toContain("---")
      expect(output2.parts[0].text).toContain("react hooks")
    })

    test("#when same keyword detected in different sessions, #then both sessions get injection", async () => {
      // given
      const collector = new ContextCollector()
      const hook = createKeywordDetectorHook(createMockPluginInput(), collector)

      const makeOutput = () => ({
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: "ultrawork do something" }],
      })

      // when - session A gets injection
      const outputA = makeOutput()
      await hook["chat.message"]({ sessionID: "session-A" }, outputA)

      // then - session A injected
      expect(outputA.parts[0].text).toContain("---")

      // when - session B (different session) sends same keyword
      const outputB = makeOutput()
      await hook["chat.message"]({ sessionID: "session-B" }, outputB)

      // then - session B also gets injection (different session = no dedup)
      expect(outputB.parts[0].text).toContain("---")
    })

    test("#when search keyword resent in same session, #then duplicate search injection is prevented", async () => {
      // given
      const collector = new ContextCollector()
      const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
      const sessionID = "dedup-search-session"

      const makeSearchOutput = () => ({
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: "search for typescript patterns" }],
      })

      // when - first search
      const output1 = makeSearchOutput()
      await hook["chat.message"]({ sessionID }, output1)

      // then - search injected
      expect(output1.parts[0].text).toContain("---")
      expect(output1.parts[0].text).toContain("typescript patterns")

      // when - undo + resend same search
      const output2 = makeSearchOutput()
      await hook["chat.message"]({ sessionID }, output2)

      // then - no duplicate injection
      expect(output2.parts[0].text).toBe("search for typescript patterns")
    })
  })
})
