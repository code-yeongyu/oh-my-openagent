import { describe, it, expect, beforeEach } from "bun:test"
import { captureSnapshot, captureDecision, resetSequence } from "./snapshot"
import {
  startReplay, nextStep, prevStep, goToStep,
  listReplayableSessions, computeDiff, formatReplayStep,
} from "./replay"
import { clearReplayData, getSnapshots } from "./storage"
import { ReplayStep, SessionSnapshot } from "./types"

describe("Session Replay", () => {
  beforeEach(() => {
    clearReplayData()
    resetSequence(SESSION_ID)
    resetSequence("session-2")
  })

  const SESSION_ID = "test-session-1"

  describe("#given snapshots are captured", () => {
    it("should capture a tool call snapshot", () => {
      // when
      const snap = captureSnapshot({
        sessionId: SESSION_ID,
        agentName: "sisyphus",
        eventType: "tool_call",
        toolName: "delegate",
        input: { task: "test" },
        durationMs: 1500,
      })

      // then
      expect(snap.id).toContain("snap_")
      expect(snap.sessionId).toBe(SESSION_ID)
      expect(snap.agentName).toBe("sisyphus")
      expect(snap.toolName).toBe("delegate")
      expect(snap.sequence).toBe(1)
    })

    it("should increment sequence per session", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_call" })
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_result" })

      // when
      const snapshots = getSnapshots(SESSION_ID)

      // then
      expect(snapshots.length).toBe(2)
      expect(snapshots[0].sequence).toBe(1)
      expect(snapshots[1].sequence).toBe(2)
    })

    it("should capture a decision node", () => {
      // given
      const snap = captureSnapshot({
        sessionId: SESSION_ID, agentName: "sisyphus", eventType: "tool_call",
        toolName: "search", input: { query: "test" },
      })

      // when
      const decision = captureDecision({
        sessionId: SESSION_ID,
        snapshotId: snap.id,
        agentName: "sisyphus",
        decision: "Use search tool for query resolution",
        reasoning: "Query requires external data lookup",
        outcome: "success",
      })

      // then
      expect(decision.id).toContain("dec_")
      expect(decision.snapshotId).toBe(snap.id)
      expect(decision.decision).toContain("search")
      expect(decision.outcome).toBe("success")
    })

    it("should capture errors", () => {
      // when
      const snap = captureSnapshot({
        sessionId: SESSION_ID,
        agentName: "oracle",
        eventType: "error",
        toolName: "search",
        error: "Network timeout",
      })

      // then
      expect(snap.error).toBe("Network timeout")
      expect(snap.eventType).toBe("error")
    })

    it("should capture state diffs", () => {
      // when
      const snap = captureSnapshot({
        sessionId: SESSION_ID,
        agentName: "sisyphus",
        eventType: "state_change",
        stateDiff: {
          "config.model": { before: "claude-sonnet-4", after: "gpt-4o" },
          "config.temperature": { before: 0.7, after: 0.3 },
        },
      })

      // then
      expect(snap.stateDiff).toBeDefined()
      expect(Object.keys(snap.stateDiff!)).toContain("config.model")
    })
  })

  describe("#given snapshots exist", () => {
    it("should start replay for a session", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_call", toolName: "t1" })
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_result", toolName: "t1" })

      // when
      const replay = startReplay(SESSION_ID)

      // then
      expect(replay.totalSnapshots).toBe(2)
      expect(replay.currentIndex).toBe(-1)
    })

    it("should step forward through snapshots", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_call", toolName: "t1" })
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_result", toolName: "t1" })
      startReplay(SESSION_ID)

      // when
      const step1 = nextStep(SESSION_ID)
      const step2 = nextStep(SESSION_ID)
      const step3 = nextStep(SESSION_ID)

      // then
      expect(step1).not.toBeNull()
      expect(step1!.snapshot.toolName).toBe("t1")
      expect(step2).not.toBeNull()
      expect(step2!.snapshot.toolName).toBe("t1")
      expect(step3).toBeNull()
    })

    it("should step backward through snapshots", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_call" })
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_result" })
      startReplay(SESSION_ID)
      nextStep(SESSION_ID)
      nextStep(SESSION_ID)

      // when
      const back = prevStep(SESSION_ID)
      const noBack = prevStep(SESSION_ID)

      // then
      expect(back).not.toBeNull()
      expect(back!.snapshot.eventType).toBe("tool_call")
      expect(noBack).toBeNull()
    })

    it("should jump to specific step", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_call", toolName: "t1" })
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_result", toolName: "t1" })
      captureSnapshot({ sessionId: SESSION_ID, agentName: "b", eventType: "tool_call", toolName: "t2" })
      startReplay(SESSION_ID)

      // when
      const step = goToStep(SESSION_ID, 2)

      // then
      expect(step).not.toBeNull()
      expect(step!.snapshot.toolName).toBe("t2")
      expect(step!.index).toBe(2)
    })

    it("should list replayable sessions", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "tool_call" })
      captureSnapshot({ sessionId: "session-2", agentName: "b", eventType: "tool_call" })

      // when
      const sessions = listReplayableSessions()

      // then
      expect(sessions.length).toBe(2)
    })

    it("should format replay step", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "sisyphus", eventType: "tool_call", toolName: "delegate" })
      startReplay(SESSION_ID)
      const step = nextStep(SESSION_ID)

      // when
      const formatted = formatReplayStep(step!)

      // then
      expect(formatted).toContain("TOOL_CALL")
      expect(formatted).toContain("sisyphus")
    })

    it("should compute diffs between snapshots", () => {
      // given
      captureSnapshot({ sessionId: SESSION_ID, agentName: "a", eventType: "state_change", stateDiff: { "key": { before: "old", after: "new" } } })
      const snapshots = getSnapshots(SESSION_ID)

      // when
      const diffs = computeDiff(snapshots)

      // then
      expect(diffs.length).toBe(0) // only 1 snapshot, no pair
    })
  })
})
