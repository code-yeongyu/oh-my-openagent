import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import {
  createTaskRecordStore,
  normalizeSenpiTeamSpec,
  resolveTeamMemberInboxDir,
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
  toTeamCoreConfig,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createTeamService } from "./team-service"

const MEMBER_TASK_ID = "st_00000001"
const MESSAGE_ID = "77777777-7777-4777-8777-777777777777"
const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function activeTeamHarness() {
  const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-team-service-"))
  tempRoots.push(cwd)
  const pi = new FakeExtensionAPI()
  const omoConfig = loadOmoConfig({ cwd }).config
  const engine = composeTaskEngine({ pi, omoConfig, cwd, sharedParentTools: () => [] })
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
    runtime: engine.runtime,
    settings: engine.settings,
    omoConfig,
    cwd,
    agentNames: new Set(Object.keys(engine.agents)),
    newMessageId: () => MESSAGE_ID,
  })
  return { runtimeState, service, stateDir }
}

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
})
