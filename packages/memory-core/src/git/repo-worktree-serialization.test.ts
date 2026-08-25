import { describe, expect, test } from "bun:test"

import type { GitExec, GitExecOptions, GitExecResult } from "./exec"
import { GitMemoryRepo } from "./repo"

class OverlapTrackingGitExec implements GitExec {
  readonly firstEntered: Promise<void>
  callCount = 0
  maxActive = 0

  private active = 0
  private releaseFirstCall: (() => void) | undefined
  private readonly firstCallReleased: Promise<void>
  private markFirstEntered: (() => void) | undefined

  constructor() {
    this.firstEntered = new Promise((resolve) => {
      this.markFirstEntered = resolve
    })
    this.firstCallReleased = new Promise((resolve) => {
      this.releaseFirstCall = resolve
    })
  }

  async run(_argv: readonly string[], _options: GitExecOptions): Promise<GitExecResult> {
    this.callCount += 1
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      if (this.callCount === 1) {
        this.markFirstEntered?.()
        await this.firstCallReleased
      }
      return { code: 0, stdout: "", stderr: "" }
    } finally {
      this.active -= 1
    }
  }

  releaseFirst(): void {
    this.releaseFirstCall?.()
  }
}

describe("GitMemoryRepo worktree administration serialization", () => {
  test("#given two worktree additions #when they target one repository #then Git administration never overlaps", async () => {
    // given
    const exec = new OverlapTrackingGitExec()
    const repo = new GitMemoryRepo({ dir: "/memory", agentId: "agent-one", exec })

    // when
    const first = repo.worktreeAdd("/checkout-one", "memory/one")
    const second = repo.worktreeAdd("/checkout-two", "memory/two")
    await exec.firstEntered
    exec.releaseFirst()
    await Promise.all([first, second])

    // then
    expect(exec.callCount).toBe(2)
    expect(exec.maxActive).toBe(1)
  })
})
