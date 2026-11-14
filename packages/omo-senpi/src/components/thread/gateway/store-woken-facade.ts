import type { WokenSessionStore } from "./woken-types"

/** The facade half: each method posts one op, stamped with the store's clock (all woken-session time comes from it). */
export function createWokenFacade(
  call: <T>(op: string, args?: unknown) => Promise<T>,
  now: () => number,
): WokenSessionStore {
  const stamped = <T>(op: string, request: object): Promise<T> => call<T>(op, { ...request, now: now() })
  return {
    request: (request) => stamped("woken_request", request),
    start: (request) => stamped("woken_start", request),
    renew: (request) => stamped("woken_renew", request),
    takeOver: (request) => stamped("woken_take_over", request),
    setState: (request) => stamped("woken_set_state", request),
    recordWaiting: (request) => stamped("woken_record_waiting", request),
    retryLater: (request) => stamped("woken_retry_later", request),
    end: (request) => stamped("woken_end", request),
    gated: (request) => stamped("woken_gated", request),
    list: () => call("woken_list"),
  }
}
