import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import {
  createTaskRecordStore,
  normalizeSenpiTeamSpec,
  resolveMemberExtensionEntryPath,
  resolveTeamMemberInboxDir,
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
  toTeamCoreConfig,
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RunnerOutcome,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createTeamService } from "./team-service"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

const MEMBER_TASK_ID = "st_00000001"
const MESSAGE_ID = "77777777-7777-4777-8777-777777777777"
const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function activeTeamHarness(sessionId?: string) {
  const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-team-service-"))
  tempRoots.push(cwd)
  const pi = new FakeExtensionAPI()
  const omoConfig = loadOmoConfig({ cwd }).config
  const engine = composeTaskEngine({ pi, omoConfig, cwd, sharedParentTools: () => [] })
  if (sessionId !== undefined) {
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
  }
  const stateDir = {
    project_dir: cwd,
    ...(engine.settings.state_dir !== undefined ? { task: { state_dir: engine.settings.state_dir } } : {}),
  }
  const config = toTeamCoreConfig(engine.settings, teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec(
    { members: [{ name: "beta", kind: "category", category: "quick", prompt: "work" }] },
    "squad",
  )
  const creating = await createRuntimeState(spec, "lead-session", "project", config)
  const runtimeState = await transitionRuntimeState(
    creating.teamRunId,
    (state) => ({
      ...state,
      status: "active",
      members: state.members.map((member) => ({ ...member, status: "running" })),
    }),
    config,
  )
  const service = createTeamService({
    manager: engine.manager,
    destruction: engine.lifecycle,
    runtime: engine.runtime,
    settings: engine.settings,
    omoConfig,
    cwd,
    agentNames: new Set(Object.keys(engine.agents)),
    newMessageId: () => MESSAGE_ID,
  })
  return { runtimeState, service, stateDir }
}

function extensionOrderHarness() {
  const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-team-service-extensions-"))
  tempRoots.push(cwd)
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.json"), `${JSON.stringify({
    categories: { quick: { model: "omo-mock/mock-1" } },
  })}\n`)
  const started: ManagedStartSpec[] = []
  const runner: ManagedRunner = {
    start: (spec) => {
      started.push(spec)
      return Promise.resolve(fakeManagedHandle(spec))
    },
  }
  const omoConfig = loadOmoConfig({ cwd }).config
  const engine = composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig,
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  const modelRegistry = createTeamServiceTestModelRegistry()
  engine.runtime.captureFrom({
    modelRegistry,
    sessionManager: { getSessionId: () => "lead-session" },
  })
  const service = createTeamService({
    manager: engine.manager,
    destruction: engine.lifecycle,
    runtime: engine.runtime,
    settings: engine.settings,
    omoConfig,
    cwd,
    agentNames: new Set(Object.keys(engine.agents)),
  })
  return { service, started }
}

function fakeManagedHandle(spec: ManagedStartSpec): ManagedChildHandle {
  return {
    task_id: spec.taskId,
    pid: undefined,
    sessionId: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise<RunnerOutcome>(() => undefined),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
}

describe("createTeamService curated agent gating", () => {
  test("#given a team member spec naming a curated read-only agent #when team_create validates members #then the curated rejection message surfaces", async () => {
    // given the real engine whose agent registry now carries the builtin curated agents
    const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-team-curated-"))
    tempRoots.push(cwd)
    const pi = new FakeExtensionAPI()
    const omoConfig = loadOmoConfig({ cwd }).config
    const engine = composeTaskEngine({ pi, omoConfig, cwd, sharedParentTools: () => [] })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "lead-session" } })
    expect(Object.keys(engine.agents)).toContain("momus")
    const service = createTeamService({
      manager: engine.manager,
      destruction: engine.lifecycle,
      runtime: engine.runtime,
      settings: engine.settings,
      omoConfig,
      cwd,
      agentNames: new Set(Object.keys(engine.agents)),
    })

    // when / then the member-validation path rejects the curated agent with the documented message
    await expect(
      service.createTeam({
        inlineSpec: {
          name: "curated-team",
          members: [{ name: "momus", kind: "subagent_type", subagent_type: "momus", prompt: "review the plan" }],
        },
      }),
    ).rejects.toThrow('curated read-only agent "momus" cannot be a team member; delegate via the task tool instead')
  })
})

describe("createTeamService lead messaging", () => {
  test("#given a mapped recipient task #when the lead sends #then the correlation event is persisted on the recipient task", async () => {
    // given
    const { runtimeState, service, stateDir } = await activeTeamHarness()
    const runtimeDir = resolveTeamRuntimeDirs(stateDir, runtimeState.teamRunId).runtimeDir
    writeFileSync(
      join(runtimeDir, "senpi-task-members.json"),
      `${JSON.stringify({ beta: MEMBER_TASK_ID }, null, 2)}\n`,
      "utf8",
    )

    // when
    await service.sendMessage(runtimeState.teamRunId, { from: "lead", to: "beta", body: "continue" })

    // then
    const store = createTaskRecordStore(stateDir)
    const eventLog = readFileSync(join(store.stateDir, "logs", `${MEMBER_TASK_ID}.jsonl`), "utf8")
    expect(eventLog).toBe(`${JSON.stringify({
      type: "team_message_sent",
      payload: { message_id: MESSAGE_ID, from: "lead", to: "beta", kind: "message" },
    })}\n`)
  })

  test("#given an active runtime member without a sidecar entry #when the lead sends #then delivery succeeds without a correlation event", async () => {
    // given
    const { runtimeState, service, stateDir } = await activeTeamHarness()

    // when
    const result = await service.sendMessage(
      runtimeState.teamRunId,
      { from: "lead", to: "beta", body: "continue" },
    )

    // then
    expect(result).toEqual({ kind: "to_members", messageId: MESSAGE_ID, recipients: ["beta"] })
    expect(existsSync(join(resolveTeamMemberInboxDir(stateDir, runtimeState.teamRunId, "beta"), `${MESSAGE_ID}.json`))).toBe(true)
    expect(existsSync(join(createTaskRecordStore(stateDir).stateDir, "logs", `${MEMBER_TASK_ID}.jsonl`))).toBe(false)
  })

  test("#given main and provider extensions #when a team member starts #then member tools load before inherited OMO extensions", async () => {
    // given
    const originalArgv = process.argv
    process.argv = ["node", "senpi", "-e", "/tmp/omo.js", "--extension", "/tmp/mock-provider.ts"]
    try {
      const { service, started } = extensionOrderHarness()

      // when
      await service.createTeam({
        inlineSpec: {
          name: "extension-order",
          members: [{ name: "beta", kind: "category", category: "quick", prompt: "work" }],
        },
      })

      // then
      expect(started[0]?.extensions).toEqual([
        resolveMemberExtensionEntryPath(),
        "/tmp/omo.js",
        "/tmp/mock-provider.ts",
      ])
    } finally {
      process.argv = originalArgv
    }
  })
})

describe("createTeamService named-team lookup", () => {
  test("#given an unknown team_name with declared teams #when createTeam runs #then the error lists the declared teams", async () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-team-named-"))
    tempRoots.push(cwd)
    mkdirSync(join(cwd, ".omo"), { recursive: true })
    writeFileSync(join(cwd, ".omo", "omo.json"), `${JSON.stringify({
      teams: {
        "declared-a": { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "work" }] },
        "declared-b": { members: [{ name: "beta", kind: "category", category: "quick", prompt: "work" }] },
      },
    })}\n`)
    const pi = new FakeExtensionAPI()
    const omoConfig = loadOmoConfig({ cwd }).config
    const engine = composeTaskEngine({ pi, omoConfig, cwd, sharedParentTools: () => [] })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "lead-session" } })
    const service = createTeamService({
      manager: engine.manager,
      destruction: engine.lifecycle,
      runtime: engine.runtime,
      settings: engine.settings,
      omoConfig,
      cwd,
      agentNames: new Set(Object.keys(engine.agents)),
    })

    // when / then
    await expect(service.createTeam({ teamName: "missing-team" })).rejects.toThrow(/missing-team[\s\S]*declared-a[\s\S]*declared-b/)
  })
})

describe("createTeamService ownership guard", () => {
  test("#given a team owned by another session #when scoped service methods are called #then they reject with an ownership error", async () => {
    // given: the runtime state lead is 'lead-session' but the current session is a stranger
    const { runtimeState, service } = await activeTeamHarness("other-session")

    // when / then: every scoped surface rejects instead of answering with misleading data
    await expect(service.listTasks(runtimeState.teamRunId, {})).rejects.toThrow("is not owned by the current session")
    await expect(service.getTask(runtimeState.teamRunId, "1")).rejects.toThrow("is not owned by the current session")
    await expect(
      service.createTask(runtimeState.teamRunId, { subject: "s", description: "d", status: "pending" }),
    ).rejects.toThrow("is not owned by the current session")
    await expect(
      service.updateTask({ teamRunId: runtimeState.teamRunId, taskId: "1", status: "completed" }),
    ).rejects.toThrow("is not owned by the current session")
    await expect(
      service.sendMessage(runtimeState.teamRunId, { from: "lead", to: "beta", body: "x" }),
    ).rejects.toThrow("is not owned by the current session")
    await expect(service.status(runtimeState.teamRunId)).rejects.toThrow("is not owned by the current session")
    await expect(service.deleteTeam({ teamRunId: runtimeState.teamRunId })).rejects.toThrow("is not owned by the current session")
    await expect(service.requestShutdown(runtimeState.teamRunId, "beta")).rejects.toThrow("is not owned by the current session")
    await expect(service.approveShutdown(runtimeState.teamRunId, "beta")).rejects.toThrow("is not owned by the current session")
    await expect(service.rejectShutdown(runtimeState.teamRunId, "beta", "keep going")).rejects.toThrow("is not owned by the current session")
  })

  test("#given the owning session #when scoped service methods are called #then they proceed", async () => {
    // given
    const { runtimeState, service } = await activeTeamHarness("lead-session")

    // when
    const tasks = await service.listTasks(runtimeState.teamRunId, {})

    // then
    expect(tasks).toEqual([])
  })
})
