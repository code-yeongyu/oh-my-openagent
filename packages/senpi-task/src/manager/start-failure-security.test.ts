import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { Theme, ThemeColor } from "@code-yeongyu/senpi"

import { RunnerError } from "../runners/in-process"
import type { RunnerFailure } from "../runners/in-process"
import type { ResolvedModelRecord } from "../state"
import { normalizeSenpiTeamSpec, spawnTeamMembers } from "../team"
import { CTX, createFakeManager, makeDeps } from "../tools/task/__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "../tools/task/execute"
import { renderTaskResultLines } from "../tools/task/renderers"
import { FakeRunner, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"
import type { ChildPlanner, StartResult } from "./types"

const ADVERSARIAL_ERROR = "ENOENT /Users/alice/.config/senpi/credentials.json api_key=sk-live-secret"
const GENERIC_START_FAILURE = "Task runner failed to start."

const RENDERER_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  italic: (text: string) => `<i>${text}</i>`,
} satisfies Pick<Theme, "fg" | "italic">

const RESOLVED_MODEL: ResolvedModelRecord = {
  provider: "openai",
  model_id: "gpt-5.6-sol",
  display: "GPT-5.6 Sol",
  reasoning_effort: "xhigh",
  source: "category",
}

afterEach(cleanupProjects)

describe("TaskManager start failure security", () => {
  test("#given an unknown runner start error containing secrets #when the task tool reports the failure #then every public and persisted surface receives only the stable classification", async () => {
    // given
    const planner: ChildPlanner = () => ({
      kind: "resolved",
      plan: { model: "openai/gpt-5.6-sol", resolved_model: RESOLVED_MODEL, category: "ultrabrain" },
    })
    const runner = new FakeRunner()
    runner.startError = new Error(ADVERSARIAL_ERROR)
    const { manager, store } = makeManager({ planner, inProcess: runner })
    let capturedStart: StartResult | undefined
    const recordingManager = createFakeManager({
      start: async (spec) => {
        const started = await manager.start(spec)
        capturedStart = started
        return started
      },
    })

    // when
    const result = await buildTaskExecute(makeDeps(recordingManager))(
      "call-secret-start-failure",
      { prompt: "private prompt payload", category: "ultrabrain", name: "secure-bg", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )
    const [row = ""] = renderTaskResultLines(result.details, RENDERER_THEME)

    // then
    if (capturedStart === undefined || capturedStart.kind !== "start_failed") throw new Error("expected start_failed")
    expect(capturedStart).toEqual({
      kind: "start_failed",
      task_id: capturedStart.task_id,
      name: "secure-bg",
      category: "ultrabrain",
      execution_mode: "in-process",
      model: "openai/gpt-5.6-sol",
      resolved_model: RESOLVED_MODEL,
      run_in_background: true,
      error_message: GENERIC_START_FAILURE,
    })

    const persisted = store.load(capturedStart.task_id)
    expect(persisted?.error_message).toBe(GENERIC_START_FAILURE)
    expect(persisted?.task_id).toBe(capturedStart.task_id)

    const eventLog = readFileSync(join(store.stateDir, "logs", `${capturedStart.task_id}.jsonl`), "utf8")
    expect(eventLog).toContain(
      `{"type":"task_start_failed","payload":{"error_message":"${GENERIC_START_FAILURE}"}}`,
    )

    const content = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(content).toBe(GENERIC_START_FAILURE)
    expect(result.details).toEqual({
      task_id: capturedStart.task_id,
      status: "error",
      mode: "spawn",
      name: "secure-bg",
      category: "ultrabrain",
      execution_mode: "in-process",
      model: "openai/gpt-5.6-sol",
      resolved_model: RESOLVED_MODEL,
      run_in_background: true,
      reason: GENERIC_START_FAILURE,
    })
    expect(row).toBe(
      `task category:ultrabrain (GPT-5.6 Sol reasoning:xhigh) <i>background</i> error id:${capturedStart.task_id} reason:${GENERIC_START_FAILURE}`,
    )

    const persistedRecord = readFileSync(join(store.stateDir, "tasks", `${capturedStart.task_id}.json`), "utf8")
    expect(JSON.stringify({ capturedStart, persistedRecord, eventLog, result, row })).not.toContain(ADVERSARIAL_ERROR)
  })

  test("#given a non-Error runner start throw containing secrets #when a team member spawn fails #then the team error contains only the stable classification", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = ADVERSARIAL_ERROR
    const { manager } = makeManager({ process: runner })
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "work" }] },
      "secure-team",
    )

    // when
    const result = await spawnTeamMembers({
      spec,
      teamRunId: "team-run-secret-test",
      manager,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      maxParallel: 1,
      deadlineAt: 1_000,
      now: () => 0,
    })

    // then
    expect(result.spawned.size).toBe(0)
    expect(result.failure?.message).toBe(`member 'alpha' failed to start: ${GENERIC_START_FAILURE}`)
    expect(result.failure?.message).not.toContain(ADVERSARIAL_ERROR)
  })

  test.each([
    ["plain object", { name: "RunnerError", failure: { kind: "depth-exceeded", message: ADVERSARIAL_ERROR } }],
    ["ordinary Error", Object.assign(new Error(ADVERSARIAL_ERROR), {
      name: "RunnerError",
      failure: { kind: "depth-exceeded", message: ADVERSARIAL_ERROR },
    })],
  ])(
    "#given a spoofed RunnerError %s #when the task starts #then it receives the generic unknown-error classification",
    async (_shape, spoofedError) => {
      // given
      const runner = new FakeRunner()
      runner.startError = spoofedError
      const { manager } = makeManager({ inProcess: runner })

      // when
      const result = await manager.start({
        prompt: "private prompt payload",
        parent_session_id: "parent-1",
        depth: 1,
        category: "quick",
      })

      // then
      expect(result.kind).toBe("start_failed")
      if (result.kind !== "start_failed") throw new Error("expected start_failed")
      expect(result.error_message).toBe(GENERIC_START_FAILURE)
      expect(JSON.stringify(result)).not.toContain(ADVERSARIAL_ERROR)
    },
  )

  test("#given a runner start Error with a hostile name accessor #when the task starts #then classification stays total and returns the generic failure", async () => {
    // given
    const runner = new FakeRunner()
    const hostileError = new Error("hidden")
    Object.defineProperty(hostileError, "name", {
      get(): never {
        throw new Error(ADVERSARIAL_ERROR)
      },
    })
    runner.startError = hostileError
    const { manager } = makeManager({ inProcess: runner })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
    })

    // then
    expect(result.kind).toBe("start_failed")
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(GENERIC_START_FAILURE)
  })

  test("#given a runner start throw whose prototype lookup is hostile #when the task starts #then classification stays total and returns the generic failure", async () => {
    // given
    const runner = new FakeRunner()
    runner.startError = new Proxy(new Error("hidden"), {
      getPrototypeOf(): never {
        throw new Error(ADVERSARIAL_ERROR)
      },
    })
    const { manager } = makeManager({ inProcess: runner })

    // when
    const result = await manager.start({
      prompt: "private prompt payload",
      parent_session_id: "parent-1",
      depth: 1,
      category: "quick",
    })

    // then
    expect(result.kind).toBe("start_failed")
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.error_message).toBe(GENERIC_START_FAILURE)
  })

  test.each([
    ["depth-exceeded", "In-process child depth limit exceeded."],
    ["session-create-failed", "In-process child session creation failed."],
    ["child-prompt-failed", "In-process child prompt failed to start."],
  ] satisfies readonly (readonly [RunnerFailure["kind"], string])[])(
    "#given a %s RunnerError containing secrets #when a named subagent start fails #then its stable classification preserves the resolved context",
    async (kind, publicMessage) => {
      // given
      const resolvedModel: ResolvedModelRecord = { ...RESOLVED_MODEL, source: "explicit" }
      const planner: ChildPlanner = () => ({
        kind: "resolved",
        plan: { model: "openai/gpt-5.6-sol", resolved_model: resolvedModel, agentType: "oracle" },
      })
      const runner = new FakeRunner()
      runner.startError = new RunnerError({ kind, message: ADVERSARIAL_ERROR, cause: new Error(ADVERSARIAL_ERROR) })
      const { manager } = makeManager({ planner, inProcess: runner })

      // when
      const result = await manager.start({
        prompt: "private prompt payload",
        parent_session_id: "parent-1",
        depth: 1,
        subagent_type: "oracle",
        name: "secure-agent",
        run_in_background: false,
      })

      // then
      expect(result.kind).toBe("start_failed")
      if (result.kind !== "start_failed") throw new Error("expected start_failed")
      expect(result).toEqual({
        kind: "start_failed",
        task_id: result.task_id,
        name: "secure-agent",
        subagent_type: "oracle",
        execution_mode: "in-process",
        model: "openai/gpt-5.6-sol",
        resolved_model: resolvedModel,
        run_in_background: false,
        error_message: publicMessage,
      })
      expect(JSON.stringify(result)).not.toContain(ADVERSARIAL_ERROR)
    },
  )
})
