import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import { createTaskLifecycle } from "../lifecycle/create"
import {
  cleanupProjects,
  FakeRegistry,
  readEvents,
  seedRecord,
  settings,
  tempStore,
} from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskManager } from "../manager/manager"
import { FakeRunner } from "../manager/__fixtures__/manager-fakes"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { TaskRecordStore } from "../store"
import { writeMemberTaskMap } from "./member-map"
import { createTeamMemberRespawnLaunchResolver } from "./member-respawn"
import { normalizeSenpiTeamSpec } from "./normalize"
import { createTeam } from "./runtime"
import { toTeamCoreConfig } from "./runtime-config"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"
import {
  cleanupTeamRuntimeTmp,
  FakeTeamManager,
  stateDirConfig,
  taskSettings,
  tempProjectDir,
} from "./__fixtures__/runtime-fakes"

afterEach(() => {
  cleanupProjects()
  cleanupTeamRuntimeTmp()
})

const now = () => 5_000_000
const LEAD_SESSION_ID = "lead-session"
const TRUSTED_ENTRY = "/trusted/member-extension.js"
const TRUSTED_INHERITED = "/trusted/provider-extension.js"

// Minimal rpc respawn fake with switch_session support, mirroring the lifecycle suite's runner so
// the full respawn -> switch -> reattach chain runs without a real child process.
class FakeRespawnRunner {
  readonly startedSpecs: RpcRunnerSpec[] = []

  start(spec: RpcRunnerSpec): RpcChildHandle {
    this.startedSpecs.push(spec)
    const pid = 1_000 + this.startedSpecs.length
    return {
      task_id: spec.task_id,
      sessionId: `resumed-${spec.task_id}`,
      pid,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => {},
      waitForIdle: () => new Promise<void>(() => {}),
      lastAssistantText: () => "reattached result",
      dispose: () => Promise.resolve(),
      terminate: () => Promise.resolve(),
      exitOutcome: () => undefined,
      waitForExit: () => Promise.resolve({ kind: "clean", facts: { pid, code: 0, signal: null, stderrTail: "" } }),
      lastSeen: () => undefined,
      switchSession: () => Promise.resolve({ cancelled: false }),
    }
  }
}

function persistSession(store: TaskRecordStore, taskId: string): string {
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  const sessionPath = join(directory, "2026-07-12_session.jsonl")
  writeFileSync(sessionPath, "{}\n")
  utimesSync(sessionPath, new Date(2_000), new Date(2_000))
  return sessionPath
}

async function givenTeamWithSuspendedMember() {
  const stateDir = stateDirConfig(tempProjectDir())
  const teamSettings = taskSettings()
  const teamManager = new FakeTeamManager()
  const created = await createTeam(
    normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "task alpha" }] },
      "squad",
    ),
    "project",
    {
      manager: teamManager,
      stateDir,
      taskSettings: teamSettings,
      leadSessionId: LEAD_SESSION_ID,
      spawnDepth: 1,
      memberExtension: { entryPath: TRUSTED_ENTRY, inheritedExtensions: [TRUSTED_INHERITED] },
    },
  )
  if (created.memberTaskIds.alpha === undefined) throw new Error("expected alpha task id")
  // The record store requires st_[0-9a-f]{8} ids; re-point the member sidecar at a valid one.
  const taskId = "st_00000001"
  await writeMemberTaskMap(resolveTeamRuntimeDirs(stateDir, created.runtimeState.teamRunId).runtimeDir, {
    alpha: taskId,
  })

  const store = tempStore()
  seedRecord(store, {
    task_id: taskId,
    parent_session_id: LEAD_SESSION_ID,
    status: "running",
    residency_state: "rpc_detached",
    execution_mode: "process",
    pid: 900,
  })
  const seeded = store.load(taskId)
  if (seeded === null) throw new Error("expected seeded member record")
  store.replace({
    ...seeded,
    name: `team:${created.runtimeState.teamRunId}:alpha`,
    spawn_spec: {
      cwd: "/tmp/project",
      extensions: ["/tmp/malicious-extension.ts"],
      member_env: { SENPI_TASK_MEMBER: "untrusted::member" },
    },
  })
  const sessionPath = persistSession(store, taskId)

  const respawnRunner = new FakeRespawnRunner()
  createTaskManager({
    store,
    runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
    planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
    config: settings(),
    cwd: "/tmp/project",
    rpcRespawnRunner: respawnRunner,
    trustedRespawnLaunch: createTeamMemberRespawnLaunchResolver({
      stateDir,
      taskSettings: teamSettings,
      memberExtension: { entryPath: TRUSTED_ENTRY, inheritedExtensions: [TRUSTED_INHERITED] },
    }),
  })
  const lifecycle = createTaskLifecycle({
    store,
    registry: new FakeRegistry(),
    config: settings(),
    now,
    signaller: { isAlive: () => false, signal: () => undefined },
    orphanKillDelayMs: 0,
  })
  return { created, taskId, store, sessionPath, respawnRunner, lifecycle, stateDir, teamSettings }
}

describe("team member revival across session resume", () => {
  test("#given a suspended team member record #when the owning session reconciles #then it revives with launch inputs from the trusted resolver and keeps its mailbox identity", async () => {
    // given a team member record suspended at shutdown, whose persisted spec carries untrusted launch inputs
    const h = await givenTeamWithSuspendedMember()

    // when the owning session resumes and reconciles
    const result = await h.lifecycle.reconcileOnSessionStart(LEAD_SESSION_ID)

    // then the member respawns from the trusted resolver: extensions and member env come from the
    // current team runtime, never from the persisted spec
    expect(result.outcomes).toContainEqual({ task_id: h.taskId, kind: "resumed", reason: "respawned and reattached" })
    expect(h.respawnRunner.startedSpecs).toHaveLength(1)
    const spec = h.respawnRunner.startedSpecs[0]
    expect(spec?.extensions).toEqual([TRUSTED_ENTRY, TRUSTED_INHERITED])
    expect(spec?.memberEnv).toMatchObject({
      SENPI_TASK_MEMBER: `${h.created.runtimeState.teamRunId}::alpha`,
      SENPI_TASK_MEMBER_TASK_ID: h.taskId,
    })
    expect(spec?.memberEnv?.SENPI_TASK_TEAM_CONFIG).not.toContain("untrusted")
    expect(spec?.resumeSessionPath).toBe(h.sessionPath)
    expect(h.store.load(h.taskId)?.residency_state).toBe("resident")
    expect(h.store.load(h.taskId)?.status).toBe("running")
  })

  test("#given a suspended member whose team run is no longer active #when the owning session reconciles #then it stays suspended with a deferred team_inactive outcome", async () => {
    // given the team runtime transitioned out of an active state while the member was suspended
    const h = await givenTeamWithSuspendedMember()
    await saveRuntimeState(
      { ...h.created.runtimeState, status: "failed" },
      toTeamCoreConfig(h.teamSettings, teamStorageBaseDir(h.stateDir)),
    )

    // when the owning session resumes and reconciles
    const result = await h.lifecycle.reconcileOnSessionStart(LEAD_SESSION_ID)

    // then the member is NOT revived and NOT lost: the claim rolls back to suspension
    expect(result.outcomes).toContainEqual({ task_id: h.taskId, kind: "deferred", reason: "team_inactive" })
    expect(h.respawnRunner.startedSpecs).toHaveLength(0)
    const record = h.store.load(h.taskId)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("rpc_detached")
    expect(record?.host_pid).toBeUndefined()
    expect(readEvents(h.store, h.taskId)).not.toContain("reconcile_lost")
  })

  test("#given a suspended member whose team run was deleted #when the owning session reconciles #then it stays suspended with a deferred team_inactive outcome", async () => {
    // given the team runtime dir was deleted while the member was suspended
    const h = await givenTeamWithSuspendedMember()
    rmSync(resolveTeamRuntimeDirs(h.stateDir, h.created.runtimeState.teamRunId).runtimeDir, {
      recursive: true,
      force: true,
    })

    // when the owning session resumes and reconciles
    const result = await h.lifecycle.reconcileOnSessionStart(LEAD_SESSION_ID)

    // then the member is NOT revived and NOT lost: the claim rolls back to suspension
    expect(result.outcomes).toContainEqual({ task_id: h.taskId, kind: "deferred", reason: "team_inactive" })
    expect(h.respawnRunner.startedSpecs).toHaveLength(0)
    const record = h.store.load(h.taskId)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("rpc_detached")
    expect(record?.host_pid).toBeUndefined()
    expect(readEvents(h.store, h.taskId)).not.toContain("reconcile_lost")
  })
})
