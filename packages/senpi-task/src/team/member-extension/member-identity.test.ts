import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema } from "@oh-my-opencode/team-core/config"
import { saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import { RuntimeStateSchema } from "@oh-my-opencode/team-core/types"

import { resolveChildSessionDir } from "../../runners/rpc/spawn"
import { createTaskRecord, parseTaskId, type TaskRecord } from "../../state"
import { createTaskRecordStore, type TaskRecordStore } from "../../store"
import { writeMemberTaskMap } from "../member-map"
import { ensureTeamRuntimeDirs, teamStorageBaseDir } from "../storage"
import {
  MemberExtensionConfigError,
  type ParsedMemberExtensionEnv,
  validateMemberExtensionIdentity,
} from "./index"

const TEAM_RUN_ID = "77777777-7777-4777-8777-777777777777"
const TASK_ID = "st_00000001"
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
type IdentityFixture = { readonly parsed: ParsedMemberExtensionEnv; readonly record: TaskRecord; readonly store: TaskRecordStore }
async function identityFixture(): Promise<IdentityFixture> {
  const root = mkdtempSync(join(tmpdir(), "senpi-member-identity-"))
  roots.push(root)
  const stateDir = join(root, "state")
  const stateConfig = { project_dir: root, task: { state_dir: stateDir } }
  const config = TeamModeConfigSchema.parse({ base_dir: teamStorageBaseDir(stateConfig) })
  const record = {
    ...createTaskRecord({
      parent_session_id: "lead-session",
      root_session_id: "lead-session",
      depth: 1,
      execution_mode: "process",
      model: "openai/gpt-5.6-sol",
      spawn_role: "team_member",
    }),
    task_id: TASK_ID, status: "running" as const, child_session_id: "child-session", pid: process.pid,
  }
  const store = createTaskRecordStore(stateConfig)
  store.save(record)
  const runtimeDirs = await ensureTeamRuntimeDirs(stateConfig, TEAM_RUN_ID, ["alice"])
  await saveRuntimeState(RuntimeStateSchema.parse({
    version: 1, teamRunId: TEAM_RUN_ID, teamName: "squad", specSource: "project",
    createdAt: 1, status: "active", leadSessionId: "lead-session",
    members: [{ name: "alice", sessionId: "child-session", agentType: "general-purpose", status: "running" }],
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 100, maxWallClockMinutes: 10, maxMemberTurns: 50 },
  }), config)
  await writeMemberTaskMap(runtimeDirs.runtimeDir, { alice: TASK_ID })
  return {
    parsed: {
      teamRunId: TEAM_RUN_ID, memberName: "alice", taskId: TASK_ID, stateDir,
      sessionDir: resolveChildSessionDir(join(stateDir, "children", TASK_ID), TASK_ID),
      config: { ...config, base_dir: config.base_dir ?? teamStorageBaseDir(stateConfig) },
      waitBounds: { min_ms: 5, default_ms: 50, max_ms: 100 },
      members: ["alice", "forged-extra"],
    },
    record, store,
  }
}

describe("validateMemberExtensionIdentity", () => {
  test("#given matching runtime, member map, task record, and child session #when validated #then runtime members replace env claims", async () => {
    // given
    const fixture = await identityFixture()
    // when
    const validated = await validateMemberExtensionIdentity(fixture.parsed, fixture.store)
    // then
    expect(validated.members).toEqual(["alice"])
  })

  test.each([
    ["team run", (fixture: IdentityFixture) => ({ ...fixture.parsed, teamRunId: "88888888-8888-4888-8888-888888888888" })],
    ["member", (fixture: IdentityFixture) => ({ ...fixture.parsed, memberName: "mallory", members: ["mallory"] })],
    ["task", (fixture: IdentityFixture) => ({ ...fixture.parsed, taskId: parseTaskId("st_00000002") })],
    ["child session", (fixture: IdentityFixture) => ({ ...fixture.parsed, sessionDir: join(fixture.parsed.stateDir, "forged-session") })],
  ] as const)("#given forged %s env #when validated #then identity is rejected", async (_label, forge) => {
    // given
    const fixture = await identityFixture()
    // when
    const validation = validateMemberExtensionIdentity(forge(fixture), fixture.store)
    // then
    await expect(validation).rejects.toBeInstanceOf(MemberExtensionConfigError)
  })

  test("#given task record and runtime disagree on child session #when validated #then identity is rejected", async () => {
    // given
    const fixture = await identityFixture()
    fixture.store.replace({ ...fixture.record, child_session_id: "other-child-session" })
    // when / then
    await expect(validateMemberExtensionIdentity(fixture.parsed, fixture.store))
      .rejects.toBeInstanceOf(MemberExtensionConfigError)
  })

  test("#given copied member environment in another process #when validated #then identity is rejected", async () => {
    // given
    const fixture = await identityFixture()
    fixture.store.replace({ ...fixture.record, pid: Math.max(process.pid, process.ppid) + 1 })

    // when / then
    await expect(validateMemberExtensionIdentity(fixture.parsed, fixture.store))
      .rejects.toMatchObject({ code: "identity_unverified" })
  })

  test("#given npm launcher owns the member process #when validated #then launcher child identity is accepted", async () => {
    // given
    const fixture = await identityFixture()
    fixture.store.replace({ ...fixture.record, pid: process.ppid })

    // when
    const validated = await validateMemberExtensionIdentity(fixture.parsed, fixture.store)

    // then
    expect(validated.members).toEqual(["alice"])
  })

  test("#given spawned task PID is not persisted yet #when validated #then identity remains pending", async () => {
    // given
    const fixture = await identityFixture()
    const { pid: _pid, ...record } = fixture.record
    fixture.store.replace(record)

    // when / then
    await expect(validateMemberExtensionIdentity(fixture.parsed, fixture.store))
      .rejects.toMatchObject({ code: "identity_pending" })
  })
})
