import { describe, it, expect, mock, beforeEach } from "bun:test"
import { PRHistoryInjector } from "./pr-history-injector"
import * as commandExecutor from "./command-executor"

mock.module("./command-executor", () => ({
  executeCommand: mock(),
}))

describe("PRHistoryInjector", () => {
  let injector: PRHistoryInjector

  beforeEach(() => {
    injector = new PRHistoryInjector({ maxDiffLength: 100 })
    mock.restore()
  })

  it("should detect PR branch", async () => {
    //#given
    const mockExecute = commandExecutor.executeCommand as any
    mockExecute.mockResolvedValueOnce("feature/task-1") // current branch
    mockExecute.mockResolvedValueOnce("origin/main") // upstream/base

    //#when
    const isPR = await injector.isPRBranch()

    //#then
    expect(isPR).toBe(true)
    expect(mockExecute).toHaveBeenCalledWith("git rev-parse --abbrev-ref HEAD")
  })

  it("should calculate diff from base branch", async () => {
    //#given
    const mockExecute = commandExecutor.executeCommand as any
    mockExecute.mockResolvedValueOnce("diff content") // diff

    //#when
    const diff = await injector.getDiff("origin/main")

    //#then
    expect(diff).toBe("diff content")
    expect(mockExecute).toHaveBeenCalledWith("git diff origin/main...HEAD")
  })

  it("should inject diff summary to context", async () => {
    //#given
    const mockExecute = commandExecutor.executeCommand as any
    mockExecute.mockResolvedValueOnce("feature/task-1") // current branch
    mockExecute.mockResolvedValueOnce("origin/main")    // base branch
    // getDiff call
    mockExecute.mockResolvedValueOnce("Summary of changes\n- file1.ts\n- file2.ts")

    //#when
    const context = await injector.injectPRHistory("")

    //#then
    expect(context).toContain("PR HISTORY (Diff from origin/main)")
    expect(context).toContain("Summary of changes")
  })

  it("should respect max diff length config", async () => {
    //#given
    const longDiff = "a".repeat(200)
    injector = new PRHistoryInjector({ maxDiffLength: 50 })
    const mockExecute = commandExecutor.executeCommand as any
    mockExecute.mockResolvedValueOnce("feature/task-1")
    mockExecute.mockResolvedValueOnce("origin/main")
    mockExecute.mockResolvedValueOnce(longDiff)

    //#when
    const context = await injector.injectPRHistory("")

    //#then
    expect(context.length).toBeLessThan(200)
    expect(context).toContain("...")
  })
})
