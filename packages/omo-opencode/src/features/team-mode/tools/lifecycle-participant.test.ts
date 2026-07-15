/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"
import { sanitizeRuntimeState } from "./lifecycle-participant"

test("redacts worktree ownership metadata from lifecycle-visible runtime state", () => {
  // given
  const runtimeState: RuntimeState = {
    version: 1,
    teamRunId: "11111111-1111-4111-8111-111111111111",
    teamName: "reviewers",
    specSource: "project",
    createdAt: 1,
    status: "active",
    members: [{
      name: "reviewer",
      agentType: "general-purpose",
      status: "running",
      worktreePath: "/repository/worktrees/reviewer",
      ownedWorktreeRoot: "/repository/worktrees/reviewer",
      worktreeOwnershipToken: "secret-token",
      worktreeCanonicalPath: "/private/canonical/reviewer",
      lastInjectedTurnMarker: "turn",
      pendingInjectedMessageIds: ["message"],
    }],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }

  // when
  const result = sanitizeRuntimeState(runtimeState)

  // then
  expect(result.members[0]).toEqual({
    name: "reviewer",
    agentType: "general-purpose",
    status: "running",
    worktreePath: "/repository/worktrees/reviewer",
  })
})
