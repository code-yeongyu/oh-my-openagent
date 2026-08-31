import { describe, test, expect } from "bun:test"
import type { SessionMessage } from "./executor-types"
import { createSyncProgressPublisher, extractProgressActivity, type SyncTaskProgressSnapshot } from "./sync-progress-reporter"
import type { DelegateTaskArgs } from "./types"

function message(role: string, id: string, parts?: SessionMessage["parts"]): SessionMessage {
  return { info: { id, role }, parts }
}

describe("extractProgressActivity", () => {
  describe("#given a mixed child transcript", () => {
    test("#then it counts assistant turns and tool parts and reports the newest tool name", () => {
      // given
      const messages: SessionMessage[] = [
        message("user", "msg_001", [{ type: "text", text: "go" }]),
        message("assistant", "msg_002", [{ type: "tool", tool: "bash" }, { type: "text", text: "running" }]),
        message("assistant", "msg_003", [{ type: "reasoning", text: "thinking" }]),
        message("assistant", "msg_004", [{ type: "tool", tool: "read" }]),
      ]

      // when
      const activity = extractProgressActivity(messages)

      // then
      expect(activity.assistantTurns).toBe(3)
      expect(activity.toolCalls).toBe(2)
      expect(activity.latestTool).toBe("read")
    })
  })

  describe("#given a transcript with no activity", () => {
    test("#then counters stay zero and latestTool stays undefined", () => {
      // given
      const messages: SessionMessage[] = [message("user", "msg_001", [{ type: "text", text: "go" }])]

      // when
      const activity = extractProgressActivity(messages)

      // then
      expect(activity.assistantTurns).toBe(0)
      expect(activity.toolCalls).toBe(0)
      expect(activity.latestTool).toBeUndefined()
    })
  })
})

describe("createSyncProgressPublisher", () => {
  const args: DelegateTaskArgs = {
    description: "Investigate the flaky test",
    prompt: "find the root cause",
    run_in_background: false,
    load_skills: [],
  }

  function buildCtx(metadataCalls: { title?: string; metadata?: Record<string, unknown> }[]) {
    return {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "test-agent",
      abort: new AbortController().signal,
      metadata: (input: { title?: string; metadata?: Record<string, unknown> }) => {
        metadataCalls.push(input)
      },
    }
  }

  describe("#given a publisher wired to a live tool context", () => {
    test("#then each snapshot republishes the base sync metadata merged with progress", async () => {
      // given
      const metadataCalls: { title?: string; metadata?: Record<string, unknown> }[] = []
      const ctx = buildCtx(metadataCalls)
      let sessionID = "ses_first"
      const publish = createSyncProgressPublisher({
        ctx,
        args,
        agentToUse: "explore",
        parentContext: { sessionID: "parent-session" },
        getSessionID: () => sessionID,
        getModel: () => undefined,
        getSpawnDepth: () => 0,
      })
      const snapshot: SyncTaskProgressSnapshot = { elapsedMs: 1500, assistantTurns: 2, toolCalls: 3, latestTool: "bash" }

      // when
      await publish(snapshot)

      // then
      expect(metadataCalls.length).toBe(1)
      expect(metadataCalls[0].title).toBe(args.description)
      const metadata = metadataCalls[0].metadata ?? {}
      expect(metadata.sync).toBe(true)
      expect(metadata.agent).toBe("explore")
      expect(metadata.sessionId).toBe("ses_first")
      expect(metadata.progress).toEqual(snapshot)
    })
  })

  describe("#given the active session changed after a fallback retry", () => {
    test("#then the next publish carries the fresh session ID instead of a stale one", async () => {
      // given
      const metadataCalls: { title?: string; metadata?: Record<string, unknown> }[] = []
      const ctx = buildCtx(metadataCalls)
      let sessionID = "ses_first"
      const publish = createSyncProgressPublisher({
        ctx,
        args,
        agentToUse: "explore",
        parentContext: { sessionID: "parent-session" },
        getSessionID: () => sessionID,
        getModel: () => undefined,
        getSpawnDepth: () => 0,
      })

      // when
      await publish({ elapsedMs: 100, assistantTurns: 1, toolCalls: 1, latestTool: "grep" })
      sessionID = "ses_retry"
      await publish({ elapsedMs: 200, assistantTurns: 1, toolCalls: 1, latestTool: "glob" })

      // then
      expect(metadataCalls.length).toBe(2)
      expect((metadataCalls[0].metadata ?? {}).sessionId).toBe("ses_first")
      expect((metadataCalls[1].metadata ?? {}).sessionId).toBe("ses_retry")
    })
  })
})
