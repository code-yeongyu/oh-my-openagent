import { describe, expect, test } from "bun:test"

import { createTeamWorkerPrompt } from "./worker-bootstrap"

describe("team-mode worker bootstrap", () => {
  test("creates a native Sisyphus OpenCode worker prompt without OMX worker bootstrap semantics", () => {
    const prompt = createTeamWorkerPrompt({
      workerId: "worker-1",
      planName: "sample-plan",
      teamStatePath: "/tmp/team-state",
      worktreePath: "/tmp/worktree",
    })

    expect(prompt).toContain("You are Sisyphus running in a native OpenCode team-mode worker session launched by Atlas.")
    expect(prompt).toContain("Atlas remains the orchestrator for this run; this pane is the implementation worker.")
    expect(prompt).toContain("Operate as a normal OpenCode Sisyphus session inside this pane.")
    expect(prompt).toContain("Do not bootstrap OMX worker runtimes, Codex worker skills, or other external worker wrappers.")
    expect(prompt).toContain("Worker ID: worker-1")
    expect(prompt).toContain("Plan: sample-plan")
    expect(prompt).toContain("Team state path: /tmp/team-state")
    expect(prompt).toContain("- Work only inside: /tmp/worktree")
    expect(prompt).not.toContain("Atlas team-mode worker")
    expect(prompt).not.toContain("Use explicit claim and transition primitives")
    expect(prompt).not.toContain("Use mailbox state")
  })
})
