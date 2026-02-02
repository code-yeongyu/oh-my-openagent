/**
 * Plan Reorganizer Hook Tests
 *
 * Tests for phase-rollback integration.
 */

import { describe, expect, it, beforeEach, mock } from "bun:test"
import { createPlanReorganizerHook } from "./index"
import type { PluginInput } from "@opencode-ai/plugin"

// Mock the reorganizePlan function
const mockReorganizePlan = mock(() => true)
mock.module("../../features/plan-reorganizer", () => ({
  reorganizePlan: mockReorganizePlan,
}))

// Mock logger
mock.module("../../shared/logger", () => ({
  log: mock(() => {}),
}))

describe("plan-reorganizer hook", () => {
  let mockCtx: PluginInput

  beforeEach(() => {
    mockCtx = {} as PluginInput
    mockReorganizePlan.mockClear()
  })

  //#region Basic functionality tests

  //#given a plan-reorganizer hook
  //#when created
  //#then it should have correct name
  it("should have correct hook name", () => {
    const hook = createPlanReorganizerHook(mockCtx)
    expect(hook.name).toBe("plan-reorganizer")
  })

  //#given a non tool.execute.after event
  //#when handler is called
  //#then it should return early
  it("should ignore non tool.execute.after events", async () => {
    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({ event: { type: "tool.execute.before" } })
    expect(mockReorganizePlan).not.toHaveBeenCalled()
  })

  //#given a tool.execute.after event for non-edit/write tool
  //#when handler is called
  //#then it should not trigger reorganization
  it("should ignore non-edit/write tools", async () => {
    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "read", input: { filePath: "/path/tasks.md" } },
      },
    })
    expect(mockReorganizePlan).not.toHaveBeenCalled()
  })

  //#given a tool.execute.after event for edit tool on non-plan file
  //#when handler is called
  //#then it should not trigger reorganization
  it("should ignore non-plan files", async () => {
    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "edit", input: { filePath: "/path/index.ts" } },
      },
    })
    expect(mockReorganizePlan).not.toHaveBeenCalled()
  })

  //#given a tool.execute.after event for edit tool on tasks.md
  //#when handler is called
  //#then it should trigger reorganization
  it("should trigger reorganization for tasks.md edits", async () => {
    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "edit", input: { filePath: "/path/tasks.md" } },
      },
    })
    expect(mockReorganizePlan).toHaveBeenCalledWith("/path/tasks.md")
  })

  //#endregion

  //#region Phase rollback integration tests

  //#given a tool.execute.after event with an error in output
  //#when the reorganization fails
  //#then it should use phase-rollback to extract failure reason
  it("should have getRollbackHistory method", () => {
    const hook = createPlanReorganizerHook(mockCtx)
    expect(typeof hook.getRollbackHistory).toBe("function")
  })

  //#given a phase rollback manager
  //#when a reorganization error occurs with type error message
  //#then it should suggest rollback to implementation phase
  it("should extract failure reason and suggest rollback phase on error", async () => {
    // Make reorganizePlan throw an error
    mockReorganizePlan.mockImplementationOnce(() => {
      throw new Error("Type error: cannot read property of undefined")
    })

    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "edit", input: { filePath: "/path/tasks.md" } },
      },
    })

    const history = hook.getRollbackHistory()
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].reason).toContain("Type error")
  })

  //#given a phase rollback manager
  //#when a test failure error occurs
  //#then it should suggest rollback to review phase
  it("should detect test failure and suggest review phase rollback", async () => {
    mockReorganizePlan.mockImplementationOnce(() => {
      throw new Error("Test failed: expected 1 but got 2")
    })

    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "write", input: { filePath: "/project/tasks.md" } },
      },
    })

    const history = hook.getRollbackHistory()
    expect(history.length).toBeGreaterThan(0)
    // Test failures detected as verification phase, rollback to review
    expect(history[0].to).toBe("review")
  })

  //#given multiple errors over time
  //#when getRollbackHistory is called
  //#then it should return all recorded rollbacks
  it("should accumulate rollback history", async () => {
    mockReorganizePlan
      .mockImplementationOnce(() => {
        throw new Error("Build failed")
      })
      .mockImplementationOnce(() => {
        throw new Error("Lint error: code quality issue")
      })

    const hook = createPlanReorganizerHook(mockCtx)

    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "edit", input: { filePath: "/path/tasks.md" } },
      },
    })

    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "edit", input: { filePath: "/path/tasks.md" } },
      },
    })

    const history = hook.getRollbackHistory()
    expect(history.length).toBe(2)
  })

  //#given a clearRollbackHistory function
  //#when called
  //#then it should clear all history
  it("should clear rollback history", async () => {
    mockReorganizePlan.mockImplementationOnce(() => {
      throw new Error("Some error")
    })

    const hook = createPlanReorganizerHook(mockCtx)
    await hook.handler({
      event: {
        type: "tool.execute.after",
        properties: { tool: "edit", input: { filePath: "/path/tasks.md" } },
      },
    })

    expect(hook.getRollbackHistory().length).toBe(1)
    hook.clearRollbackHistory()
    expect(hook.getRollbackHistory().length).toBe(0)
  })

  //#endregion
})
