import { describe, expect, it } from "bun:test"

import type { SessionShutdownEvent } from "@code-yeongyu/senpi"
import type {
  ReconcileResult,
  SuspendInput,
  SuspendSummary,
  TaskLifecycle,
  TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { wireEventBridge } from "./event-bridge"
import type { TaskEngine } from "./engine"
import type { SessionTransitionBridge } from "./session-transition-bridge"
import type { TaskStatusUi } from "./status-ui"

const fakeSummary: SuspendSummary = {
  suspended_in_process: 0,
  suspended_rpc: 0,
  suspended_pending: 0,
  disposed: 0,
  failures: [],
}

type HarnessOptions = {
  readonly outcomes?: ReconcileResult["outcomes"]
  readonly records?: Readonly<Record<string, TaskRecord>>
  readonly cleanupDeleted?: readonly string[]
  readonly resumptionChannelCount?: number
}

function wireHarness(sessionId?: string, options: HarnessOptions = {}) {
  const pi = new FakeExtensionAPI()
  const calls: SuspendInput[] = []
  const order: string[] = []
  const warnings: Array<{ message: string; details?: unknown }> = []
  const infos: Array<{ message: string; details?: unknown }> = []
  const reconcileCalls: Array<string | undefined> = []
  const notifyCalls: Array<{ sessionId: string; parentState: unknown }> = []
  const livenessCalls: string[] = []
  const resumptionCalls: number[] = []

  const engine = {
    runtime: {
      captureFrom: () => {
        order.push("capture")
      },
      sessionId: () => sessionId,
      clearUi: () => {
        order.push("clearUi")
      },
      parentState: () => ({ kind: "idle" as const }),
    },
    lifecycle: {
      suspendOnSessionShutdown: async (input: SuspendInput) => {
        calls.push(input)
        order.push("suspend")
        return fakeSummary
      },
      destroyResidentTask: async () => {},
      admitResident: async () => ({ kind: "admitted" as const }),
      reconcileOnSessionStart: async (parentSessionId?: string) => {
        reconcileCalls.push(parentSessionId)
        order.push("reconcile")
        return { outcomes: options.outcomes ?? [] }
      },
      // Two markers make a missing `await` observable: without it the next chain step ("poll")
      // would land between cleanup:start and cleanup:end.
      cleanupExpiredRecords: async () => {
        order.push("cleanup:start")
        await Promise.resolve()
        order.push("cleanup:end")
        return { deleted: options.cleanupDeleted ?? [], retained: [] as readonly string[] }
      },
    } satisfies Partial<TaskLifecycle> as unknown as TaskLifecycle,
    manager: {
      get: (taskId: string) => options.records?.[taskId],
    } as unknown as TaskEngine["manager"],
    notifier: {
      reconcileUnnotifiedNotifications: (input: { sessionId: string; parentState: unknown }) => {
        notifyCalls.push(input)
        order.push("notify")
      },
    } as unknown as TaskEngine["notifier"],
    planner: {} as TaskEngine["planner"],
    agents: {},
    omoConfig: {} as TaskEngine["omoConfig"],
    settings: {} as TaskEngine["settings"],
    stateDir: "",
    memberLiveness: { acknowledgePersisted: async () => {} } as unknown as TaskEngine["memberLiveness"],
    notifyOwnedMemberLiveness: async (record: TaskRecord) => {
      livenessCalls.push(record.task_id)
      order.push(`liveness:${record.task_id}`)
    },
    appendTaskEvent: () => {},
    onStoreMutation: () => () => {},
  } as unknown as TaskEngine

  const statusUi = {
    scheduleSync: () => {
      order.push("statusSync")
    },
    syncNow: () => {},
    dispose: () => {
      order.push("dispose")
    },
  } as unknown as TaskStatusUi

  const transitions = {
    onBeforeSwitch: () => {},
    onBeforeCompact: () => {},
    onCompact: () => {},
    onShutdown: () => {
      order.push("transition")
    },
    onSessionStart: () => {
      order.push("onSessionStart")
    },
  } as unknown as SessionTransitionBridge

  const state = {
    reconcileTeamMailbox: async () => {
      order.push("reclaim")
    },
    leadPollers: {
      tick: async () => {
        order.push("poll")
      },
      shutdown: () => {
        order.push("leadShutdown")
      },
    },
    resumptionChannels: {
      emitSessionStart: async () => {
        const count = options.resumptionChannelCount ?? 0
        resumptionCalls.push(count)
        order.push(`resumptionStart:${count}`)
      },
      emitShutdown: async () => {
        resumptionCalls.push(0)
        order.push("resumptionShutdown:0")
      },
    },
  } as unknown as Parameters<typeof wireEventBridge>[5]

  const ctx = {
    logger: {
      info: (message: string, details?: unknown) => {
        infos.push({ message, details })
      },
      warn: (message: string, details?: unknown) => {
        warnings.push({ message, details })
      },
      error: () => {},
    },
    config: { getFlag: () => undefined },
  } as unknown as ComponentContext

  wireEventBridge(pi, ctx, engine, statusUi, transitions, state)

  return { pi, calls, order, warnings, infos, reconcileCalls, notifyCalls, livenessCalls, resumptionCalls }
}

describe("event-bridge session_start recovery chain", () => {
  it("#given a resumed session with a revived record #when session_start fires #then the chain runs in the planned order with the session id threaded", async () => {
    // given
    const revived = { task_id: "task-revived" } as TaskRecord
    const { pi, order, reconcileCalls, notifyCalls, livenessCalls, resumptionCalls } = wireHarness("parent-session", {
      outcomes: [
        { task_id: "task-revived", kind: "resumed" },
        { task_id: "task-gone", kind: "resumed" },
      ],
      records: { "task-revived": revived },
      resumptionChannelCount: 2,
    })

    // when
    await pi.dispatch("session_start", {}, {})

    // then
    expect(order).toEqual([
      "capture",
      "onSessionStart",
      "reconcile",
      "liveness:task-revived",
      "resumptionStart:2",
      "reclaim",
      "notify",
      "cleanup:start",
      "cleanup:end",
      "poll",
      "statusSync",
    ])
    expect(reconcileCalls).toEqual(["parent-session"])
    expect(notifyCalls).toEqual([{ sessionId: "parent-session", parentState: { kind: "idle" } }])
    expect(livenessCalls).toEqual(["task-revived"])
    expect(resumptionCalls).toEqual([2])
  })

  it("#given no captured session id #when session_start fires #then the legacy sweep still runs with undefined while the scoped notification branch is skipped", async () => {
    // given
    const { pi, order, reconcileCalls, notifyCalls, warnings } = wireHarness(undefined)

    // when
    await pi.dispatch("session_start", {}, {})

    // then
    expect(reconcileCalls).toEqual([undefined])
    expect(notifyCalls).toHaveLength(0)
    expect(order).toEqual([
      "capture",
      "onSessionStart",
      "reconcile",
      "resumptionStart:0",
      "reclaim",
      "cleanup:start",
      "cleanup:end",
      "poll",
      "statusSync",
    ])
    expect(warnings).toHaveLength(0)
  })

  it("#given expired records #when session_start fires #then the awaited ttl cleanup runs after notification reconcile and logs deletions", async () => {
    // given
    const { pi, order, infos } = wireHarness("parent-session", { cleanupDeleted: ["task-old"] })

    // when
    await pi.dispatch("session_start", {}, {})

    // then
    expect(order.indexOf("cleanup:start")).toBeGreaterThan(order.indexOf("notify"))
    expect(order.indexOf("poll")).toBeGreaterThan(order.indexOf("cleanup:end"))
    expect(infos).toHaveLength(1)
    expect(infos[0]?.message).toContain("ttl cleanup")
  })
})

describe("event-bridge session_shutdown", () => {
  it("#given a session_shutdown with a reason and a captured session id #when the event fires #then it suspends with parentSessionId and reason", async () => {
    // given
    const { pi, calls, order } = wireHarness("parent-session")

    // when
    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as SessionShutdownEvent,
      {},
    )

    // then
    expect(order).toEqual([
      "capture",
      "transition",
      "clearUi",
      "dispose",
      "leadShutdown",
      "resumptionShutdown:0",
      "suspend",
    ])
    expect(calls).toEqual([{ parentSessionId: "parent-session", reason: "quit" }])
  })

  it("#given a session_shutdown with no captured session id #when the event fires #then it warns and does not suspend", async () => {
    // given
    const { pi, calls, order, warnings } = wireHarness(undefined)

    // when
    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "reload" } as SessionShutdownEvent,
      {},
    )

    // then
    expect(order).toEqual([
      "capture",
      "transition",
      "clearUi",
      "dispose",
      "leadShutdown",
      "resumptionShutdown:0",
    ])
    expect(calls).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain("session id")
  })

  it("#given a session_shutdown with a missing reason #when the event fires #then it warns and does not suspend", async () => {
    // given
    const { pi, calls, warnings } = wireHarness("parent-session")

    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown" } as unknown as SessionShutdownEvent, {})

    // then
    expect(calls).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain("reason")
  })
})
