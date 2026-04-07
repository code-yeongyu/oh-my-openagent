import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "./constants"
import {
  resolveSubagentSpawnContext,
  getMaxSubagentDepth,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  createSubagentDepthLimitError,
  createSubagentDescendantLimitError,
  getMaxRootSessionSpawnBudget,
  DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET,
} from "./subagent-spawn-limits"

function createMockClient(sessionGet: OpencodeClient["session"]["get"]): OpencodeClient {
  return {
    session: {
      get: sessionGet,
    },
  } as OpencodeClient
}

describe("resolveSubagentSpawnContext", () => {
  describe("#given session.get returns an SDK error response", () => {
    test("throws a fail-closed spawn blocked error", async () => {
      // given
      const client = createMockClient(async () => ({
        error: "lookup failed",
        data: undefined,
      }))

      // when
      const result = resolveSubagentSpawnContext(client, "parent-session")

      // then
      await expect(result).rejects.toThrow(/background_task\.maxDescendants cannot be enforced safely.*lookup failed/)
    })
  })

  describe("#given session.get returns no session data", () => {
    test("throws a fail-closed spawn blocked error", async () => {
      // given
      const client = createMockClient(async () => ({
        data: undefined,
      }))

      // when
      const result = resolveSubagentSpawnContext(client, "parent-session")

      // then
      await expect(result).rejects.toThrow(/background_task\.maxDescendants cannot be enforced safely.*No session data returned/)
    })
  })

  describe("depth calculation smoke tests (regression guard)", () => {
    test("root session (no parentID) reports depth 0 and childDepth 1", async () => {
      // given - a root session with no parent
      const client = createMockClient(async (opts) => {
        if (opts.path.id === "root-session") {
          return { data: { id: "root-session", parentID: undefined } }
        }
        return { error: "not found", data: undefined }
      })

      // when
      const result = await resolveSubagentSpawnContext(client, "root-session")

      // then
      expect(result.rootSessionID).toBe("root-session")
      expect(result.parentDepth).toBe(0)
      expect(result.childDepth).toBe(1)
    })

    test("depth-1 child reports childDepth 2", async () => {
      // given - child -> root chain
      const client = createMockClient(async (opts) => {
        if (opts.path.id === "child-1") {
          return { data: { id: "child-1", parentID: "root-session" } }
        }
        if (opts.path.id === "root-session") {
          return { data: { id: "root-session", parentID: undefined } }
        }
        return { error: "not found", data: undefined }
      })

      // when
      const result = await resolveSubagentSpawnContext(client, "child-1")

      // then
      expect(result.rootSessionID).toBe("root-session")
      expect(result.parentDepth).toBe(1)
      expect(result.childDepth).toBe(2)
    })

    test("depth-2 grandchild reports childDepth 3", async () => {
      // given - grandchild -> child -> root chain
      const client = createMockClient(async (opts) => {
        const sessions: Record<string, { id: string; parentID?: string }> = {
          "grandchild": { id: "grandchild", parentID: "child" },
          "child": { id: "child", parentID: "root" },
          "root": { id: "root", parentID: undefined },
        }
        const session = sessions[opts.path.id]
        if (session) return { data: session }
        return { error: "not found", data: undefined }
      })

      // when
      const result = await resolveSubagentSpawnContext(client, "grandchild")

      // then
      expect(result.rootSessionID).toBe("root")
      expect(result.parentDepth).toBe(2)
      expect(result.childDepth).toBe(3)
    })

    test("depth at DEFAULT_MAX_SUBAGENT_DEPTH reports exact max childDepth", async () => {
      // given - chain of exactly DEFAULT_MAX_SUBAGENT_DEPTH depth
      // With default=3: session-3 -> session-2 -> session-1 -> root
      const sessions: Record<string, { id: string; parentID?: string }> = {
        "root": { id: "root" },
      }
      for (let i = 1; i <= DEFAULT_MAX_SUBAGENT_DEPTH; i++) {
        sessions[`session-${i}`] = {
          id: `session-${i}`,
          parentID: i === 1 ? "root" : `session-${i - 1}`,
        }
      }

      const client = createMockClient(async (opts) => {
        const session = sessions[opts.path.id]
        if (session) return { data: session }
        return { error: "not found", data: undefined }
      })

      // when - resolve from the deepest session
      const deepest = `session-${DEFAULT_MAX_SUBAGENT_DEPTH}`
      const result = await resolveSubagentSpawnContext(client, deepest)

      // then - childDepth should be DEFAULT_MAX_SUBAGENT_DEPTH + 1 (exceeds limit)
      expect(result.childDepth).toBe(DEFAULT_MAX_SUBAGENT_DEPTH + 1)
      expect(result.parentDepth).toBe(DEFAULT_MAX_SUBAGENT_DEPTH)
    })

    test("detects parent cycle and throws", async () => {
      // given - A -> B -> A (cycle)
      const client = createMockClient(async (opts) => {
        const sessions: Record<string, { id: string; parentID?: string }> = {
          "session-a": { id: "session-a", parentID: "session-b" },
          "session-b": { id: "session-b", parentID: "session-a" },
        }
        const session = sessions[opts.path.id]
        if (session) return { data: session }
        return { error: "not found", data: undefined }
      })

      // when
      const result = resolveSubagentSpawnContext(client, "session-a")

      // then
      await expect(result).rejects.toThrow(/session parent cycle/)
    })
  })
})

describe("getMaxSubagentDepth", () => {
  test("returns DEFAULT_MAX_SUBAGENT_DEPTH when no config", () => {
    expect(getMaxSubagentDepth()).toBe(DEFAULT_MAX_SUBAGENT_DEPTH)
    expect(getMaxSubagentDepth(undefined)).toBe(DEFAULT_MAX_SUBAGENT_DEPTH)
  })

  test("returns config.maxDepth when provided", () => {
    expect(getMaxSubagentDepth({ maxDepth: 5 })).toBe(5)
    expect(getMaxSubagentDepth({ maxDepth: 1 })).toBe(1)
    expect(getMaxSubagentDepth({ maxDepth: 0 })).toBe(0)
  })

  test("default is 3", () => {
    expect(DEFAULT_MAX_SUBAGENT_DEPTH).toBe(3)
  })
})

describe("getMaxRootSessionSpawnBudget", () => {
  test("returns DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET when no config", () => {
    expect(getMaxRootSessionSpawnBudget()).toBe(DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET)
  })

  test("returns config.maxDescendants when provided", () => {
    expect(getMaxRootSessionSpawnBudget({ maxDescendants: 10 })).toBe(10)
  })

  test("default is 50", () => {
    expect(DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET).toBe(50)
  })
})

describe("createSubagentDepthLimitError", () => {
  test("includes childDepth, maxDepth, and session IDs in message", () => {
    const error = createSubagentDepthLimitError({
      childDepth: 4,
      maxDepth: 3,
      parentSessionID: "parent-123",
      rootSessionID: "root-456",
    })

    expect(error.message).toContain("child depth 4")
    expect(error.message).toContain("maxDepth=3")
    expect(error.message).toContain("parent-123")
    expect(error.message).toContain("root-456")
    expect(error.message).toContain("spawn blocked")
  })
})

describe("createSubagentDescendantLimitError", () => {
  test("includes descendant count, max, and root session ID", () => {
    const error = createSubagentDescendantLimitError({
      rootSessionID: "root-789",
      descendantCount: 50,
      maxDescendants: 50,
    })

    expect(error.message).toContain("root-789")
    expect(error.message).toContain("50")
    expect(error.message).toContain("maxDescendants=50")
    expect(error.message).toContain("spawn blocked")
  })
})
