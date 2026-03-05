declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")
import { resolveTaskTarget, type TaskTarget } from "./task-target-resolver"
import type { DelegateTaskArgs } from "./types"
import type { TaskAgentCatalog } from "./agent-catalog"

function createArgs(overrides?: Partial<DelegateTaskArgs>): DelegateTaskArgs {
  return {
    description: "Test task",
    prompt: "Do something",
    run_in_background: false,
    load_skills: [],
    ...overrides,
  }
}

function createAvailableCategories() {
  return [
    { name: "visual-engineering", description: "Frontend work" },
    { name: "deep", description: "Deep research" },
    { name: "quick", description: "Quick tasks" },
    { name: "ultrabrain", description: "Hard logic" },
  ]
}

function createAgentCatalog(): TaskAgentCatalog {
  return {
    all: [
      { name: "oracle", mode: "subagent" },
      { name: "explore", mode: "subagent" },
      { name: "librarian", mode: "subagent" },
      { name: "sisyphus", mode: "primary" },
    ],
    callable: [
      { name: "oracle", mode: "subagent" },
      { name: "explore", mode: "subagent" },
      { name: "librarian", mode: "subagent" },
    ],
    primary: [{ name: "sisyphus", mode: "primary" }],
  }
}

describe("resolveTaskTarget", () => {
  const categories = createAvailableCategories()
  const catalog = createAgentCatalog()

  describe("continuation path", () => {
    test("returns continuation when session_id is present", () => {
      //#given
      const args = createArgs({ session_id: "ses_123", subagent_type: "deep" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("continuation")
    })

    test("session_id takes priority over explicit category", () => {
      //#given
      const args = createArgs({ session_id: "ses_123", category: "quick" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("continuation")
    })

    test("session_id takes priority over subagent_type", () => {
      //#given
      const args = createArgs({ session_id: "ses_123", subagent_type: "oracle" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("continuation")
    })
  })

  describe("explicit category path", () => {
    test("returns category with canonical name when category provided", () => {
      //#given
      const args = createArgs({ category: " DEEP " })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("category")
      expect((result as Extract<TaskTarget, { kind: "category" }>).name).toBe("deep")
    })

    test("returns category when category provided (case insensitive)", () => {
      //#given
      const args = createArgs({ category: "QUICK" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("category")
      expect((result as Extract<TaskTarget, { kind: "category" }>).name).toBe("quick")
    })

    test("explicit category does not set correctedFrom", () => {
      //#given
      const args = createArgs({ category: "deep" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("category")
      expect((result as Extract<TaskTarget, { kind: "category" }>).correctedFrom).toBeUndefined()
    })
  })

  describe("missing target error", () => {
    test("returns error when neither category nor subagent_type provided", () => {
      //#given
      const args = createArgs()

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("error")
      expect((result as Extract<TaskTarget, { kind: "error" }>).code).toBe("missing_target")
    })

    test("returns error when subagent_type is empty string", () => {
      //#given
      const args = createArgs({ subagent_type: "" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("error")
      expect((result as Extract<TaskTarget, { kind: "error" }>).code).toBe("missing_target")
    })

    test("returns error when subagent_type is whitespace only", () => {
      //#given
      const args = createArgs({ subagent_type: "   " })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("error")
    })
  })

  describe("agent match path", () => {
    test("returns agent when subagent_type matches callable agent", () => {
      //#given
      const args = createArgs({ subagent_type: "oracle" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("oracle")
    })

    test("returns agent with canonical name (case insensitive)", () => {
      //#given
      const args = createArgs({ subagent_type: "ORACLE" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("oracle")
    })

    test("trims whitespace from subagent_type", () => {
      //#given
      const args = createArgs({ subagent_type: "  explore  " })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("explore")
    })
  })

  describe("category correction path", () => {
    test("corrects subagent_type=deep to category when no agent match", () => {
      //#given
      const args = createArgs({ subagent_type: "deep" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("category")
      const catResult = result as Extract<TaskTarget, { kind: "category" }>
      expect(catResult.name).toBe("deep")
      expect(catResult.correctedFrom).toBe("subagent_type")
    })

    test("corrects subagent_type=quick to category when no agent match", () => {
      //#given
      const args = createArgs({ subagent_type: "quick" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("category")
      expect((result as Extract<TaskTarget, { kind: "category" }>).correctedFrom).toBe("subagent_type")
    })

    test("corrects case-insensitive category-like subagent_type", () => {
      //#given
      const args = createArgs({ subagent_type: " VISUAL-ENGINEERING " })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("category")
      const catResult = result as Extract<TaskTarget, { kind: "category" }>
      expect(catResult.name).toBe("visual-engineering")
      expect(catResult.correctedFrom).toBe("subagent_type")
    })
  })

  describe("agent wins over category overlap", () => {
    test("returns agent when name exists as both agent and category", () => {
      //#given - create catalog with an agent that also exists as category
      const overlapCatalog: TaskAgentCatalog = {
        all: [{ name: "deep", mode: "subagent" }],
        callable: [{ name: "deep", mode: "subagent" }],
        primary: [],
      }
      const args = createArgs({ subagent_type: "deep" })

      //#when
      const result = resolveTaskTarget(args, categories, overlapCatalog)

      //#then - agent wins over category
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("deep")
    })
  })

  describe("fail-open behavior", () => {
    test("passes through subagent_type as agent when catalog is null", () => {
      //#given
      const args = createArgs({ subagent_type: "deep" })

      //#when
      const result = resolveTaskTarget(args, categories, null)

      //#then - fails open, does not auto-correct to category
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("deep")
    })

    test("passes through unknown agent when catalog is null", () => {
      //#given
      const args = createArgs({ subagent_type: "unknown-agent" })

      //#when
      const result = resolveTaskTarget(args, categories, null)

      //#then - fails open, preserves original name
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("unknown-agent")
    })

    test("does not auto-correct category-like name when catalog unavailable", () => {
      //#given
      const args = createArgs({ subagent_type: "quick" })

      //#when
      const result = resolveTaskTarget(args, categories, null)

      //#then - should be agent, not category
      expect(result.kind).toBe("agent")
      expect((result as Extract<TaskTarget, { kind: "agent" }>).name).toBe("quick")
    })
  })

  describe("unknown agent error", () => {
    test("returns error when subagent_type does not match agent or category", () => {
      //#given
      const args = createArgs({ subagent_type: "nonexistent" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then
      expect(result.kind).toBe("error")
      const errorResult = result as Extract<TaskTarget, { kind: "error" }>
      expect(errorResult.code).toBe("unknown_agent")
      expect(errorResult.message).toContain("nonexistent")
    })

    test("does not match primary agents", () => {
      //#given - sisyphus is in primary bucket
      const args = createArgs({ subagent_type: "sisyphus" })

      //#when
      const result = resolveTaskTarget(args, categories, catalog)

      //#then - should be unknown (primary agents not callable)
      expect(result.kind).toBe("error")
    })
  })
})
