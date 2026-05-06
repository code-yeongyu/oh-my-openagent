import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import type { RuntimeState } from "../../features/team-mode/types"
import { saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import { createTeamToolGating } from "./hook"

function createConfig(overrides?: Partial<TeamModeConfig>, baseDir = "/tmp/team-mode"): TeamModeConfig {
  return {
    enabled: true,
    tmux_visualization: false,
    max_parallel_members: 4,
    max_members: 8,
    max_messages_per_run: 10_000,
    max_wall_clock_minutes: 120,
    max_member_turns: 500,
    base_dir: baseDir,
    message_payload_max_bytes: 32_768,
    recipient_unread_max_bytes: 262_144,
    mailbox_poll_interval_ms: 3_000,
    ...overrides,
  }
}

function createRuntimeState(): RuntimeState {
  return {
    version: 1,
    teamRunId: "11111111-1111-4111-8111-111111111111",
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [
      { name: "m1", sessionId: "member-session-1", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] },
      { name: "m2", sessionId: "member-session-2", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] },
    ],
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10_000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
  }
}

async function seedTeams(baseDir: string, ...runtimeStates: RuntimeState[]): Promise<void> {
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
  await Promise.all(runtimeStates.map(async (runtimeState) => {
    await mkdir(path.join(baseDir, "runtime", runtimeState.teamRunId), { recursive: true })
    await saveRuntimeState(runtimeState, config)
  }))
}

async function runHook(tool: string, sessionID: string, args: Record<string, unknown>, config?: Partial<TeamModeConfig>, baseDir = "/tmp/team-mode"): Promise<void> {
  const hook = createTeamToolGating({ directory: baseDir } as PluginInput, createConfig(config, baseDir))
  await hook["tool.execute.before"]?.({ tool, sessionID, callID: "call-1" }, { args })
}

describe("createTeamToolGating", () => {
  const temporaryDirectories: string[] = []

  beforeEach(() => {
    temporaryDirectories.length = 0
    clearTeamSessionRegistry()
  })

  afterEach(async () => {
    clearTeamSessionRegistry()
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => rm(directoryPath, { recursive: true, force: true })))
  })

  test("allows a fresh session to call team_create", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_create", "fresh-session", {}, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("allows team_list from a fresh session", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_list", "fresh-session", {}, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("rejects team_create when the caller is already a team member", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_create", "member-session-1", {}, undefined, baseDir)

    // then
    await expect(result).rejects.toThrow("team_create denied: session is already a participant of team 11111111-1111-4111-8111-111111111111")
  })

  test("allows the target member to self-approve shutdown", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_approve_shutdown", "member-session-1", { teamRunId: "11111111-1111-4111-8111-111111111111", memberName: "m1" }, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("allows the lead to force-approve shutdown", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_approve_shutdown", "lead-session", { teamRunId: "11111111-1111-4111-8111-111111111111", memberName: "m1" }, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("rejects a non-target member from approving shutdown", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_approve_shutdown", "member-session-2", { teamRunId: "11111111-1111-4111-8111-111111111111", memberName: "m1" }, undefined, baseDir)

    // then
    await expect(result).rejects.toThrow("team_approve_shutdown: caller must be target member or team lead")
  })

  test("allows delegate-task for team members without a run-wide budget", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("delegate-task", "member-session-1", {}, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("allows team_delete for the lead of the target team", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_delete", "lead-session", { teamRunId: "11111111-1111-4111-8111-111111111111" }, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("no-ops for unrelated tools without querying team state", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("write", "fresh-session", {}, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("allows team_send_message during the spawn race when runtime state lacks the member's sessionId but the registry already has it", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    const staleRuntimeState: RuntimeState = {
      ...createRuntimeState(),
      members: [
        { name: "m1", agentType: "general-purpose", status: "pending", pendingInjectedMessageIds: [] },
        { name: "m2", agentType: "general-purpose", status: "pending", pendingInjectedMessageIds: [] },
      ],
    }
    await seedTeams(baseDir, staleRuntimeState)
    registerTeamSession("just-spawned-session", {
      teamRunId: "11111111-1111-4111-8111-111111111111",
      memberName: "m1",
      role: "member",
    })

    // when
    const result = runHook("team_send_message", "just-spawned-session", { teamRunId: "11111111-1111-4111-8111-111111111111" }, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("allows team_send_message from a lead whose session is tracked only in the registry", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    const staleRuntimeState: RuntimeState = {
      ...createRuntimeState(),
      leadSessionId: undefined,
      members: [
        { name: "lead", agentType: "leader", status: "pending", pendingInjectedMessageIds: [] },
      ],
    }
    await seedTeams(baseDir, staleRuntimeState)
    registerTeamSession("caller-lead-session", {
      teamRunId: "11111111-1111-4111-8111-111111111111",
      memberName: "lead",
      role: "lead",
    })

    // when
    const result = runHook("team_send_message", "caller-lead-session", { teamRunId: "11111111-1111-4111-8111-111111111111" }, undefined, baseDir)

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("rejects team_send_message when the session is not in the registry and not in runtime state", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    await seedTeams(baseDir, createRuntimeState())

    // when
    const result = runHook("team_send_message", "unknown-session", { teamRunId: "11111111-1111-4111-8111-111111111111" }, undefined, baseDir)

    // then
    await expect(result).rejects.toThrow("team-mode tool team_send_message denied: not a participant of team 11111111-1111-4111-8111-111111111111")
  })

  test("rejects team_send_message when the registry only has the caller for a different team than the requested teamRunId", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-tool-gating-"))
    temporaryDirectories.push(baseDir)
    const emptyState: RuntimeState = { ...createRuntimeState(), members: [] }
    await seedTeams(baseDir, emptyState)
    registerTeamSession("cross-team-session", {
      teamRunId: "22222222-2222-4222-8222-222222222222",
      memberName: "other-team-member",
      role: "member",
    })

    // when
    const result = runHook("team_send_message", "cross-team-session", { teamRunId: "11111111-1111-4111-8111-111111111111" }, undefined, baseDir)

    // then
    await expect(result).rejects.toThrow("denied: not a participant of team 11111111-1111-4111-8111-111111111111")
  })
})
