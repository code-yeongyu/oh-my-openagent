/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  addPendingEdge,
  createPendingEdgeMap,
  ensureDependenciesCompleted,
  ensureForwardStatusTransition,
  wouldCreateCycle,
} from "./team-task-dependency"
import type { TeamTask, TeamTaskStatus } from "./types"

function createTask(id: string, status: TeamTaskStatus, blockedBy: string[] = []): TeamTask {
  return {
    id,
    subject: `Task ${id}`,
    description: `Description ${id}`,
    status,
    blocks: [],
    blockedBy,
  }
}

describe("agent-teams task dependency utilities", () => {
  test("detects cycle from existing blockedBy chain", () => {
    //#given
    const tasks = new Map<string, TeamTask>([
      ["A", createTask("A", "pending", ["B"])],
      ["B", createTask("B", "pending")],
    ])
    const pending = createPendingEdgeMap()
    const readTask = (id: string) => tasks.get(id) ?? null

    //#when
    const hasCycle = wouldCreateCycle("B", "A", pending, readTask)

    //#then
    expect(hasCycle).toBe(true)
  })

  test("detects cycle from pending edge map", () => {
    //#given
    const tasks = new Map<string, TeamTask>([["A", createTask("A", "pending")]])
    const pending = createPendingEdgeMap()
    addPendingEdge(pending, "A", "B")
    const readTask = (id: string) => tasks.get(id) ?? null

    //#when
    const hasCycle = wouldCreateCycle("B", "A", pending, readTask)

    //#then
    expect(hasCycle).toBe(true)
  })

  test("returns false when dependency graph has no cycle", () => {
    //#given
    const tasks = new Map<string, TeamTask>([
      ["A", createTask("A", "pending")],
      ["B", createTask("B", "pending", ["A"])],
    ])
    const pending = createPendingEdgeMap()
    const readTask = (id: string) => tasks.get(id) ?? null

    //#when
    const hasCycle = wouldCreateCycle("C", "B", pending, readTask)

    //#then
    expect(hasCycle).toBe(false)
  })

  test("allows forward status transitions and blocks backward transitions", () => {
    //#then
    expect(() => ensureForwardStatusTransition("pending", "in_progress")).not.toThrow()
    expect(() => ensureForwardStatusTransition("in_progress", "completed")).not.toThrow()
    expect(() => ensureForwardStatusTransition("in_progress", "pending")).toThrow(
      "invalid_status_transition:in_progress->pending",
    )
  })

  test("requires blockers to be completed for in_progress/completed", () => {
    //#given
    const tasks = new Map<string, TeamTask>([
      ["done", createTask("done", "completed")],
      ["wait", createTask("wait", "pending")],
    ])
    const readTask = (id: string) => tasks.get(id) ?? null

    //#then
    expect(() => ensureDependenciesCompleted("pending", ["wait"], readTask)).not.toThrow()
    expect(() => ensureDependenciesCompleted("in_progress", ["done"], readTask)).not.toThrow()
    expect(() => ensureDependenciesCompleted("completed", ["wait"], readTask)).toThrow(
      "blocked_by_incomplete:wait:pending",
    )
  })
})
