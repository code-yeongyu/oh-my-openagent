import type {
  ManagedChildEvent,
  ReconcileResult,
  SendInput,
  SuspendInput,
  TaskLifecycle,
  TaskRecord,
  TaskRunStats,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { wireEventBridge } from "./event-bridge"
import { fakeSummary } from "./event-bridge.test-fixtures"
import type { TaskEngine } from "./engine"
import type { SessionTransitionBridge } from "./session-transition-bridge"
import type { TaskStatusUi } from "./status-ui"

type HarnessOptions = {
  readonly outcomes?: ReconcileResult["outcomes"]
  readonly records?: Readonly<Record<string, TaskRecord>>
  readonly liveRunStats?: Readonly<Record<string, TaskRunStats>>
  readonly cleanupDeleted?: readonly string[]
  readonly resumptionChannelCount?: number
  readonly withRpc?: boolean | "emit-only"
}

export function wireHarness(sessionId?: string, options: HarnessOptions = {}) {
  const pi = new FakeExtensionAPI()
  const rpcHandlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  if (options.withRpc !== undefined && options.withRpc !== false) {
    const rpc = {
      emit: (name: string, data: unknown) => pi.rpcEvents.push({ name, data }),
    } as NonNullable<SenpiExtensionAPI["rpc"]>
    if (options.withRpc === true) {
      rpc.handle = (name: string, handler: (data: unknown) => unknown | Promise<unknown>) => {
        rpcHandlers.set(name, handler)
      }
    }
    pi.rpc = rpc
  }
  const records = { ...(options.records ?? {}) }
  const storeMutationListeners = new Set<() => void>()
  const childListeners = new Map<string, Set<(event: ManagedChildEvent) => void>>()
  const calls: SuspendInput[] = []
  const sendCalls: SendInput[] = []
  const cancelCalls: Array<{ idOrName: string; reason?: string }> = []
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
      cleanupExpiredRecords: async () => {
        order.push("cleanup:start")
        await Promise.resolve()
        order.push("cleanup:end")
        return { deleted: options.cleanupDeleted ?? [], retained: [] as readonly string[] }
      },
    } satisfies Partial<TaskLifecycle> as unknown as TaskLifecycle,
    manager: {
      get: (taskId: string) => records[taskId],
      list: (scope: { scope: "all" } | { scope: "parent-session"; session_id: string }) =>
        Object.values(records)
          .filter((record) => scope.scope === "all" || record.parent_session_id === scope.session_id)
          .map((record) => ({ record })),
      runStatsSnapshot: (taskId: string) => options.liveRunStats?.[taskId],
      subscribeChild: (taskId: string, listener: (event: ManagedChildEvent) => void) => {
        const listeners = childListeners.get(taskId) ?? new Set()
        listeners.add(listener)
        childListeners.set(taskId, listeners)
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) childListeners.delete(taskId)
        }
      },
      sendToTask: async (input: SendInput) => {
        sendCalls.push(input)
        const record = records[input.idOrName]
        if (
          record !== undefined &&
          input.callerSessionId !== undefined &&
          record.parent_session_id !== input.callerSessionId &&
          input.allScope !== true
        ) {
          return {
            kind: "scope_denied" as const,
            task_id: record.task_id,
            owning_session_id: record.parent_session_id,
            reason: `Task ${record.task_id} belongs to session ${record.parent_session_id}; pass all_scope to send across sessions.`,
          }
        }
        return {
          kind: "steered" as const,
          task_id: input.idOrName,
          status: "running" as const,
          delivered: input.deliverAs,
        }
      },
      cancelTask: async (idOrName: string, reason?: string) => {
        cancelCalls.push({ idOrName, ...(reason === undefined ? {} : { reason }) })
        const record =
          records[idOrName] ?? Object.values(records).find((candidate) => candidate.name === idOrName)
        return {
          kind: "cancelled" as const,
          task_id: record?.task_id ?? idOrName,
          previous_status: record?.status ?? ("running" as const),
        }
      },
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
    onStoreMutation: (listener: () => void) => {
      storeMutationListeners.add(listener)
      return () => storeMutationListeners.delete(listener)
    },
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

  return {
    pi,
    calls,
    order,
    warnings,
    infos,
    reconcileCalls,
    notifyCalls,
    livenessCalls,
    resumptionCalls,
    rpcHandlers,
    sendCalls,
    cancelCalls,
    records,
    emitChildEvent: (taskId: string, event: ManagedChildEvent) => {
      for (const listener of childListeners.get(taskId) ?? []) listener(event)
    },
    subscriberCount: (taskId: string) => childListeners.get(taskId)?.size ?? 0,
    invokeRpc: async (name: string, data: unknown) => {
      const handler = rpcHandlers.get(name)
      if (handler === undefined) throw new Error(`Missing RPC handler: ${name}`)
      return handler(data)
    },
    emitStoreMutation: () => {
      for (const listener of storeMutationListeners) listener()
    },
  }
}
