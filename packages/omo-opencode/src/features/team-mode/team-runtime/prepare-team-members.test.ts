/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { getAgentDisplayName } from "../../../shared/agent-display-names"
import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"
import type { TeamSpec } from "../types"
import { prepareTeamMembers, resolveMemberDirectory, TeamMemberPreflightError } from "./prepare-team-members"
import { WorktreeOwnershipConflictError } from "./worktree-ownership"

describe("resolveMemberDirectory", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }))
  })

  test("owns only the exact member leaf when nested ancestors are missing", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-race-"))
    temporaryDirectories.push(projectRoot)
    const worktreePath = path.join(projectRoot, "new-root", "nested", "member")

    // when
    const firstResult = await resolveMemberDirectory(worktreePath, projectRoot)
    const secondResult = resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(firstResult).toMatchObject({
      directory: worktreePath,
      ownedWorktreeRoot: worktreePath,
      worktreeCanonicalPath: worktreePath,
      worktreeOwnershipToken: expect.any(String),
    })
    await expect(secondResult).rejects.toBeInstanceOf(WorktreeOwnershipConflictError)
  })

  test("owns the exact member leaf beneath a pre-existing parent", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-parent-"))
    temporaryDirectories.push(projectRoot)
    const existingParent = path.join(projectRoot, "existing")
    const worktreePath = path.join(existingParent, "member")
    await mkdir(existingParent, { recursive: true })

    // when
    const result = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(result).toMatchObject({
      directory: worktreePath,
      ownedWorktreeRoot: worktreePath,
      worktreeCanonicalPath: worktreePath,
      worktreeOwnershipToken: expect.any(String),
    })
  })

  test("records no owned root when the worktree path already exists", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-existing-"))
    temporaryDirectories.push(projectRoot)
    const worktreePath = path.join(projectRoot, "existing", "member")
    await mkdir(worktreePath, { recursive: true })

    // when
    const result = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(result).toEqual({ directory: worktreePath })
  })

  test("rejects when the exact member leaf is an existing file", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-file-"))
    temporaryDirectories.push(projectRoot)
    const worktreePath = path.join(projectRoot, "member")
    await writeFile(worktreePath, "not-a-directory")

    // when
    const result = resolveMemberDirectory(worktreePath, projectRoot)

    // then
    await expect(result).rejects.toThrow()
  })

  test("concurrent sibling creation owns each exact member leaf independently", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-siblings-"))
    temporaryDirectories.push(projectRoot)
    const firstWorktreePath = path.join(projectRoot, "shared", "member-a")
    const secondWorktreePath = path.join(projectRoot, "shared", "member-b")

    // when
    const [firstResult, secondResult] = await Promise.all([
      resolveMemberDirectory(firstWorktreePath, projectRoot),
      resolveMemberDirectory(secondWorktreePath, projectRoot),
    ])

    // then
    expect(firstResult).toMatchObject({
      directory: firstWorktreePath,
      ownedWorktreeRoot: firstWorktreePath,
      worktreeCanonicalPath: firstWorktreePath,
      worktreeOwnershipToken: expect.any(String),
    })
    expect(secondResult).toMatchObject({
      directory: secondWorktreePath,
      ownedWorktreeRoot: secondWorktreePath,
      worktreeCanonicalPath: secondWorktreePath,
      worktreeOwnershipToken: expect.any(String),
    })
  })
})

describe("prepareTeamMembers lead reuse", () => {
  for (const projectAgentName of ["sisyphus", getAgentDisplayName("sisyphus")] as const) {
    test(`rejects project agent collision '${projectAgentName}' before caller-session reuse`, async () => {
      // given
      const appAgents = mock(async () => ({
        data: [{
          name: projectAgentName,
          mode: "subagent",
          native: false,
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        }],
      }))
      const launch = mock(async () => ({ id: "unexpected-task" }))
      const spec: TeamSpec = {
        version: 1,
        name: "project-collision-team",
        createdAt: 1,
        leadAgentId: "lead",
        members: [{
          kind: "subagent_type",
          name: "lead",
          subagent_type: projectAgentName,
          backendType: "in-process",
          isActive: true,
        }],
      }
      const ctx = unsafeTestValue<ExecutorContext>({
        client: { app: { agents: appAgents } },
        manager: { launch },
        directory: "/project",
      })

      // when
      const result = prepareTeamMembers({
        spec,
        ctx,
        reusesCallerLeadSession: true,
        parentSessionPermission: [],
        teamSessionPermission: [],
      })

      // then
      await expect(result).rejects.toBeInstanceOf(TeamMemberPreflightError)
      await expect(result).rejects.toThrow("member-only")
      expect(appAgents).toHaveBeenCalledWith({ query: { directory: "/project" } })
      expect(launch).not.toHaveBeenCalled()
    })
  }
})
