/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import type { TeamSpec } from "../types"
import { markStuckCreatingTeamFailed } from "./creating-resume"
import { createRuntimeState, loadRuntimeState, transitionRuntimeState } from "./store"

describe("stale creating recovery", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("#given recovery read creating #when the creator activates before recovery claims #then the active worktree is not cleaned", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-creating-race-"))
    temporaryDirectories.push(baseDir)
    const worktreePath = path.join(baseDir, "worktrees", "lead")
    await mkdir(worktreePath, { recursive: true })
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "activation-race",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{
        kind: "subagent_type",
        name: "lead",
        subagent_type: "sisyphus",
        backendType: "in-process",
        isActive: true,
        worktreePath,
      }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)
    const recoveryReadCreating = Promise.withResolvers<void>()
    const allowRecoveryToContinue = Promise.withResolvers<void>()
    const recovery = (async () => {
      const staleCreatingState = await loadRuntimeState(created.teamRunId, config)
      recoveryReadCreating.resolve()
      await allowRecoveryToContinue.promise
      return markStuckCreatingTeamFailed(staleCreatingState, config)
    })()
    await recoveryReadCreating.promise

    // when
    await transitionRuntimeState(created.teamRunId, (state) => ({ ...state, status: "active" }), config)
    allowRecoveryToContinue.resolve()

    // then
    const [recoveryOutcome] = await Promise.allSettled([recovery])
    expect(existsSync(worktreePath)).toBe(true)
    expect(recoveryOutcome?.status).toBe("fulfilled")
    expect((await loadRuntimeState(created.teamRunId, config)).status).toBe("active")
  })
})
