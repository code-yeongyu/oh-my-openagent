import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ManagedChildHandle, ManagedRunner, ManagedStartSpec, RunnerOutcome, TaskRecord } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { composeTaskEngine } from "./engine"
import {
  TEAM_MEMBER_LIVENESS_MESSAGE_TYPE,
  createTeamMemberLivenessNotifier,
} from "./member-liveness"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function memberRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_00000001",
    name: "team:11111111-1111-4111-8111-111111111111:alpha",
    parent_session_id: "lead-session",
    root_session_id: "lead-session",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status: "error",
    residency_state: "resident",
    created_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:01.000Z",
    error_message: "RPC child killed by signal SIGKILL",
    killed: true,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

describe("team member liveness notifier", () => {
  test("#given a SIGKILL member exit while the lead streams #when the terminal record is observed #then one liveness injection reaches the lead with the member and last state", () => {
    // given
    const pi = new FakeExtensionAPI()
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator(
      (content, options) => pi.sendUserMessage(content, options),
      { scheduleFlush: (flush) => scheduled.push(flush) },
    )
    const notifier = createTeamMemberLivenessNotifier({
      pi,
      coordinator,
      isStreaming: () => true,
    })

    // when
    notifier.notifyTerminal(memberRecord())
    notifier.notifyTerminal(memberRecord())
    for (const flush of scheduled) flush()

    // then
    expect(pi.userMessages).toEqual([{
      content: "Team member liveness: alpha exited abnormally; last known state: error. Reason: RPC child killed by signal SIGKILL",
      options: { deliverAs: "steer" },
    }])
  })

  test("#given a process member killed by SIGKILL #when the manager observes its terminal outcome #then the wired lead notifier injects liveness", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-member-liveness-"))
    roots.push(root)
    const pi = new FakeExtensionAPI()
    const crashing = createCrashingRunner()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd: root }).config,
      cwd: root,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => crashing.runner, process: () => crashing.runner },
    })
    const started = await engine.manager.start({
      prompt: "member work",
      name: "team:11111111-1111-4111-8111-111111111111:alpha",
      parent_session_id: "lead-session",
      depth: 1,
      execution_mode: "process",
      model: "omo-mock/mock-1",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected member to start")

    // when
    crashing.failSigkill()
    await flushMicrotasks()

    // then
    const liveness = pi.messages.find((entry) => entry.message.customType === TEAM_MEMBER_LIVENESS_MESSAGE_TYPE)
    expect(liveness?.message.details).toEqual({
      memberName: "alpha",
      lastKnownState: "error",
      reason: "RPC child killed by signal SIGKILL",
    })
  })

  test("#given a normal member completion #when its terminal record is observed #then no liveness event is injected", () => {
    // given
    const sent: Record<string, unknown>[] = []
    const notifier = createTeamMemberLivenessNotifier({
      pi: { sendMessage: (message) => sent.push(message) },
      isStreaming: () => false,
    })

    // when
    notifier.notifyTerminal(memberRecord({ status: "completed", error_message: undefined, killed: undefined }))

    // then
    expect(sent).toEqual([])
    expect(TEAM_MEMBER_LIVENESS_MESSAGE_TYPE).toBe("senpi-task.team-member-liveness")
  })
})

function createCrashingRunner(): { readonly runner: ManagedRunner; failSigkill: () => void } {
  let resolveOutcome: (outcome: RunnerOutcome) => void = () => undefined
  const outcome = new Promise<RunnerOutcome>((resolve) => { resolveOutcome = resolve })
  const runner: ManagedRunner = {
    start: async (spec: ManagedStartSpec): Promise<ManagedChildHandle> => ({
      task_id: spec.taskId,
      sessionId: "member-session",
      pid: 4242,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome,
      lastAssistantText: () => undefined,
      terminate: async () => undefined,
      dispose: async () => undefined,
    }),
  }
  return {
    runner,
    failSigkill: () => resolveOutcome({
      status: "error",
      failure: { kind: "child-prompt-failed", message: "RPC child killed by signal SIGKILL" },
      killed: true,
    }),
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
