import type { IntakeMarkStore, SessionWaitStore } from "./session-wait-types"
import type { WokenSessionStore } from "./woken-types"

type Call = <T>(op: string, args?: unknown) => Promise<T>

/** The facade half: each method posts one op, stamped with the store's clock (all woken-session time comes from it). */
export function createWokenFacade(call: Call, now: () => number): WokenSessionStore {
  const stamped = <T>(op: string, request: object): Promise<T> => call<T>(op, { ...request, now: now() })
  return {
    request: (request) => stamped("woken_request", request),
    start: (request) => stamped("woken_start", request),
    renew: (request) => stamped("woken_renew", request),
    takeOver: (request) => stamped("woken_take_over", request),
    setState: (request) => stamped("woken_set_state", request),
    recordWaiting: (request) => stamped("woken_record_waiting", request),
    retryLater: (request) => stamped("woken_retry_later", request),
    clearWaiting: (request) => stamped("woken_clear_waiting", request),
    end: (request) => stamped("woken_end", request),
    gated: (request) => stamped("woken_gated", request),
    list: () => call("woken_list"),
    countWake: (request) => stamped("woken_count_wake", request),
    wakeCount: (request) => stamped("woken_wake_count", request),
    resetCount: (request) => stamped("woken_reset_count", request),
    sessionWork: (request) => stamped("woken_session_work", request),
  }
}

export function createSessionWaitFacade(call: Call, now: () => number): SessionWaitStore {
  const stamped = <T>(op: string, request: object): Promise<T> => call<T>(op, { ...request, now: now() })
  return {
    write: (request) => stamped("woken_wait_write", request),
    read: (request) => stamped("woken_wait_read", request),
    clear: (request) => stamped("woken_wait_clear", request),
    waitingOn: (request) => stamped("woken_waiting_on", request),
  }
}

export function createIntakeMarkFacade(call: Call, now: () => number): IntakeMarkStore {
  return {
    record: (request) => call("woken_mark_record", { ...request, now: now() }),
    marked: () => call("woken_mark_marked"),
    pending: () => call("woken_mark_pending"),
    drained: (request) => call("woken_mark_drained", { ...request, now: now() }),
    commandFor: (request) => call("woken_command_for", request),
    openForCommand: (request) => call("woken_open_for_command", request),
    openSessions: () => call("woken_open_sessions"),
  }
}
