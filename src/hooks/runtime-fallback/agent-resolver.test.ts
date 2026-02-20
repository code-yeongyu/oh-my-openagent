import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  detectAgentFromSession,
  normalizeAgentName,
  resolveAgentForSession,
  AGENT_NAMES,
} from "./agent-resolver"
import {
  _resetForTesting,
  updateSessionAgent,
  pinSessionAgent,
} from "../../features/claude-code-session-state"

describe("agent-resolver", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  describe("detectAgentFromSession", () => {
    test("should detect agent name embedded in sessionID", () => {
      // given
      const sessionID = "ses_abc123_atlas_work"

      // when
      const result = detectAgentFromSession(sessionID)

      // then
      expect(result).toBe("atlas")
    })

    test("should detect sisyphus-junior (hyphenated agent)", () => {
      // given
      const sessionID = "ses_sisyphus-junior_task"

      // when
      const result = detectAgentFromSession(sessionID)

      // then
      expect(result).toBe("sisyphus-junior")
    })

    test("should prefer longer match (sisyphus-junior over sisyphus)", () => {
      // given
      const sessionID = "ses_sisyphus-junior_123"

      // when
      const result = detectAgentFromSession(sessionID)

      // then - should match sisyphus-junior, not just sisyphus
      expect(result).toBe("sisyphus-junior")
    })

    test("should return undefined when no agent found", () => {
      // given
      const sessionID = "ses_abc123_random_session"

      // when
      const result = detectAgentFromSession(sessionID)

      // then
      expect(result).toBeUndefined()
    })

    test("should be case-insensitive", () => {
      // given
      const sessionID = "ses_ORACLE_query"

      // when
      const result = detectAgentFromSession(sessionID)

      // then
      expect(result).toBe("oracle")
    })
  })

  describe("normalizeAgentName", () => {
    test("should return exact match for known agent", () => {
      expect(normalizeAgentName("sisyphus")).toBe("sisyphus")
      expect(normalizeAgentName("oracle")).toBe("oracle")
      expect(normalizeAgentName("atlas")).toBe("atlas")
    })

    test("should normalize case", () => {
      expect(normalizeAgentName("SISYPHUS")).toBe("sisyphus")
      expect(normalizeAgentName("Oracle")).toBe("oracle")
    })

    test("should trim whitespace", () => {
      expect(normalizeAgentName("  atlas  ")).toBe("atlas")
    })

    test("should extract agent from display name", () => {
      // given - display names like "Atlas (Work Orchestrator)"
      expect(normalizeAgentName("Atlas (Work Orchestrator)")).toBe("atlas")
      expect(normalizeAgentName("Prometheus (Planner)")).toBe("prometheus")
      expect(normalizeAgentName("Hephaestus (Craftsman)")).toBe("hephaestus")
    })

    test("should return undefined for unknown agent", () => {
      expect(normalizeAgentName("unknown-agent")).toBeUndefined()
      expect(normalizeAgentName("random")).toBeUndefined()
    })

    test("should return undefined for empty/undefined input", () => {
      expect(normalizeAgentName(undefined)).toBeUndefined()
      expect(normalizeAgentName("")).toBeUndefined()
    })
  })

  describe("resolveAgentForSession", () => {
    test("should prioritize session agent over event agent", () => {
      // given - session agent set to atlas, event says prometheus
      const sessionID = "test-resolve-priority"
      updateSessionAgent(sessionID, "atlas")

      // when
      const result = resolveAgentForSession(sessionID, "prometheus")

      // then - session agent wins
      expect(result).toBe("atlas")
    })

    test("should prioritize pinned session agent over event agent", () => {
      // given - pinned agent set to atlas
      const sessionID = "test-resolve-pinned"
      pinSessionAgent(sessionID, "atlas")

      // when - event says prometheus, updateSessionAgent also says prometheus
      updateSessionAgent(sessionID, "prometheus")
      const result = resolveAgentForSession(sessionID, "prometheus")

      // then - pinned agent wins
      expect(result).toBe("atlas")
    })

    test("should fall back to event agent when no session agent exists", () => {
      // given - no session agent
      const sessionID = "test-resolve-event"

      // when
      const result = resolveAgentForSession(sessionID, "oracle")

      // then
      expect(result).toBe("oracle")
    })

    test("should fall back to sessionID pattern when no agents set", () => {
      // given - no session or event agent, but sessionID contains agent name
      const sessionID = "ses_librarian_search"

      // when
      const result = resolveAgentForSession(sessionID)

      // then
      expect(result).toBe("librarian")
    })

    test("should return undefined when nothing resolves", () => {
      // given - no agents anywhere
      const sessionID = "test-no-agent"

      // when
      const result = resolveAgentForSession(sessionID)

      // then
      expect(result).toBeUndefined()
    })

    test("should normalize display name from event agent", () => {
      // given
      const sessionID = "test-normalize-event"

      // when - event agent is a display name
      const result = resolveAgentForSession(sessionID, "Atlas (Work Orchestrator)")

      // then - normalized to config key
      expect(result).toBe("atlas")
    })
  })
})
