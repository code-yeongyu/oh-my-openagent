import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
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
    notify_on_terminal: false,
    ...overrides,
  }
}

describe("team member liveness notifier", () => {
  test("#given a SIGKILL member exit while the lead streams #when the terminal record is observed #then one structured liveness injection reaches the lead", () => {
    const pi = new FakeExtensionAPI()
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator(
      (message, options) => pi.sendMessage(message, { triggerTurn: true, deliverAs: options.deliverAs }),
      { scheduleFlush: (flush) => scheduled.push(flush) },
    )
    const notifier = createTeamMemberLivenessNotifier({ pi, coordinator, isStreaming: () => true })

    notifier.notifyTerminal(memberRecord())
    notifier.notifyTerminal(memberRecord())
    for (const flush of scheduled) flush()

    expect(pi.messages).toEqual([{
      message: {
        customType: "omo-senpi:wake",
        content: "Team member liveness: alpha exited abnormally; last known state: error. Reason: RPC child killed by signal SIGKILL",
        display: false,
        details: [{
          customType: TEAM_MEMBER_LIVENESS_MESSAGE_TYPE,
          details: {
            memberName: "alpha",
            lastKnownState: "error",
            reason: "RPC child killed by signal SIGKILL",
            deliveryKey: "team-member-liveness:st_00000001:0",
          },
        }],
      },
      options: { triggerTurn: true, deliverAs: "steer" },
    }])
  })

  test("#given an injected liveness message not yet persisted #when persistence checks run #then ack waits for the exact JSONL marker", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-liveness-persistence-"))
    roots.push(root)
    const sessionFile = join(root, "session.jsonl")
    const persisted: number[] = []
    const retries: Array<() => void> = []
    let resolvePersisted: () => void = () => undefined
    const persistedSignal = new Promise<void>((resolve) => { resolvePersisted = resolve })
    const notifier = createTeamMemberLivenessNotifier({
      pi: new FakeExtensionAPI(),
      isStreaming: () => false,
      markDelivered: (record) => {
        persisted.push(record.notification.run_epoch)
        resolvePersisted()
      },
      scheduleRetry: (retry) => retries.push(retry),
      maxPersistenceRetries: 1,
    })
    notifier.notifyTerminal(memberRecord())

    await notifier.acknowledgePersisted(() => sessionFile)
    expect(persisted).toEqual([])
    expect(retries).toHaveLength(1)

    writeFileSync(sessionFile, `${JSON.stringify({
      type: "custom_message",
      customType: TEAM_MEMBER_LIVENESS_MESSAGE_TYPE,
      content: "liveness",
      display: false,
      details: { deliveryKey: "team-member-liveness:st_00000001:0" },
    })}\n`)
    retries.shift()?.()
    await withTimeout(persistedSignal, 1_000)

    expect(persisted).toEqual([0])
  })

  test("#given a failed direct injection #when the delivery promise rejects #then local dedupe clears and a bounded retry sends again", async () => {
    const attempts: string[] = []
    const retries: Array<() => void> = []
    const notifier = createTeamMemberLivenessNotifier({
      pi: {
        sendMessage: () => {
          attempts.push("send")
          return attempts.length === 1 ? Promise.reject(new Error("provider rejected")) : Promise.resolve()
        },
      },
      isStreaming: () => false,
      scheduleRetry: (retry) => retries.push(retry),
      maxDeliveryRetries: 1,
    })

    notifier.notifyTerminal(memberRecord())
    await flushMicrotasks()
    expect(attempts).toEqual(["send"])
    expect(retries).toHaveLength(1)

    retries.shift()?.()
    await flushMicrotasks()
    expect(attempts).toEqual(["send", "send"])
  })

  test("#given a failed coordinator delivery #when its promise rejects #then the liveness injection is requeued and delivered on retry", async () => {
    const deliveries: string[] = []
    const retries: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator((message) => {
      deliveries.push(message.content)
      return deliveries.length === 1 ? Promise.reject(new Error("admission failed")) : Promise.resolve()
    })
    const notifier = createTeamMemberLivenessNotifier({
      pi: new FakeExtensionAPI(),
      coordinator,
      isStreaming: () => false,
      scheduleRetry: (retry) => retries.push(retry),
      maxDeliveryRetries: 1,
    })

    notifier.notifyTerminal(memberRecord())
    coordinator.flushOnIdle()
    await flushMicrotasks()
    expect(retries).toHaveLength(1)

    retries.shift()?.()
    coordinator.flushOnIdle()
    await flushMicrotasks()
    expect(deliveries).toHaveLength(2)
  })

  test("#given the liveness epoch is already persisted #when a restarted notifier observes the terminal record #then it suppresses replay", () => {
    const pi = new FakeExtensionAPI()
    const notifier = createTeamMemberLivenessNotifier({
      pi,
      isStreaming: () => false,
      wasDelivered: () => true,
    })

    notifier.notifyTerminal(memberRecord())

    expect(pi.messages).toEqual([])
  })

  test("#given a normal member completion #when observed #then no liveness event is injected", () => {
    const sent: Record<string, unknown>[] = []
    const notifier = createTeamMemberLivenessNotifier({
      pi: { sendMessage: (message) => { sent.push(message) } },
      isStreaming: () => false,
    })

    notifier.notifyTerminal(memberRecord({ status: "completed", error_message: undefined, killed: undefined }))

    expect(sent).toEqual([])
  })

  test("#given an errored member record suspended between shutdown and revival #when observed #then no liveness death event is injected", () => {
    // given a member whose errored record was suspended at session shutdown and still awaits revival
    const sent: Record<string, unknown>[] = []
    const notifier = createTeamMemberLivenessNotifier({
      pi: { sendMessage: (message) => { sent.push(message) } },
      isStreaming: () => false,
    })

    // when the suspended record is re-observed in either suspended residency
    notifier.notifyTerminal(memberRecord({ residency_state: "persisted_only", killed: undefined }))
    notifier.notifyTerminal(memberRecord({ residency_state: "rpc_detached", killed: undefined }))

    // then the member is treated as suspended, not dead
    expect(sent).toEqual([])
  })
})

async function withTimeout<T>(signal: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([signal, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
