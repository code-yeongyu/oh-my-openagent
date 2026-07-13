import { describe, expect, test } from "bun:test"

import { completedTeamTaskUpdates } from "./team-e2e-analysis.mjs"

describe("completedTeamTaskUpdates", () => {
  test("#given claimed and nonterminal updates #when completed updates are counted #then only concrete completed task states count", () => {
    // given
    const updates = [
      { details: { kind: "claimed", task: { status: "claimed" } } },
      { details: { kind: "claimed", task: { status: "completed" } } },
      { details: { kind: "updated", task: { status: "in_progress" } } },
      { details: { kind: "updated" } },
      { details: { kind: "updated", task: { status: "completed" } } },
    ]

    // when
    const completed = completedTeamTaskUpdates(updates)

    // then
    expect(completed).toHaveLength(1)
    expect(completed[0]?.details?.task?.status).toBe("completed")
  })
})
