import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"
import {
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
  toTeamCoreConfig,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { createOwnedMemberLivenessNotifier } from "./owned-member-liveness"
import { TaskRuntimeContext } from "./runtime-context"

const TEAM_RUN_ID = "11111111-1111-4111-8111-111111111111"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function projectDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-member-liveness-"))
  roots.push(directory)
  return directory
}

function memberRecord(residencyState: TaskRecord["residency_state"]): TaskRecord {
  return {
    task_id: "st_00000001",
    name: `team:${TEAM_RUN_ID}:alpha`,
    parent_session_id: "lead-session",
    root_session_id: "lead-session",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status: "error",
    residency_state: residencyState,
    created_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:01.000Z",
    error_message: "RPC child killed by signal SIGKILL",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: false,
  }
}

function activeTeamRuntime(): RuntimeState {
  return {
    version: 1,
    teamRunId: TEAM_RUN_ID,
    teamName: "squad",
    specSource: "project",
    createdAt: 1_000,
    status: "active",
    leadSessionId: "lead-session",
    members: [{ name: "alpha", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] }],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10_000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
}

function harness() {
  const project = projectDir()
  const settings = OmoTaskSettingsSchema.parse({})
  const stateDir = { project_dir: project }
  const runtime = new TaskRuntimeContext(project)
  runtime.captureFrom({ sessionManager: { getSessionId: () => "lead-session" } })
  const notified: TaskRecord[] = []
  const errors: unknown[] = []
  const observe = createOwnedMemberLivenessNotifier({
    stateDir,
    settings,
    runtime,
    notifier: {
      notifyTerminal: (record) => {
        notified.push(record)
      },
      acknowledgePersisted: () => Promise.resolve(),
    },
    onError: (error) => {
      errors.push(error)
    },
  })
  return { observe, notified, errors, stateDir, settings }
}

async function givenActiveOwnedTeam(h: ReturnType<typeof harness>): Promise<void> {
  mkdirSync(resolveTeamRuntimeDirs(h.stateDir, TEAM_RUN_ID).runtimeDir, { recursive: true })
  await saveRuntimeState(activeTeamRuntime(), toTeamCoreConfig(h.settings, teamStorageBaseDir(h.stateDir)))
}

describe("owned member liveness", () => {
  test("#given an errored member record suspended between shutdown and revival #when re-observed #then no death notification fires", async () => {
    // given an active team owned by this session whose errored member record was suspended at shutdown
    const h = harness()
    await givenActiveOwnedTeam(h)

    // when the suspended record is re-observed in either suspended residency
    await h.observe(memberRecord("persisted_only"))
    await h.observe(memberRecord("rpc_detached"))

    // then the member is treated as suspended, not dead
    expect(h.notified).toEqual([])
    expect(h.errors).toEqual([])
  })

  test("#given a resident errored member record owned by this session #when observed #then the death notification still fires", async () => {
    // given the same owned team runtime
    const h = harness()
    await givenActiveOwnedTeam(h)

    // when a genuinely resident terminal member record is observed
    await h.observe(memberRecord("resident"))

    // then the suspension guard does not suppress a real member death
    expect(h.notified).toHaveLength(1)
    expect(h.errors).toEqual([])
  })
})
