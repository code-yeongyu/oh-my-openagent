import type { Timers } from "@oh-my-opencode/device-service-core"
import { failureFromError, nextActionFor, remoteFailure } from "./codes"
import type { Opts, RemoteFailure } from "./types"

/**
 * The deadline table (design v8-core r2, B1). A member's default exceeds every bound beneath it, so the lower layer's typed
 * error surfaces first. The member's clock starts once its connection is proven: a cold connect spends at most the
 * local API handshake (10,000 ms) plus `CONNECT_SLACK_MS` before it.
 */
export const BOUNDS = {
  /** L0 handshake (device-service-core local-api/client.ts:70). */
  handshake: 10_000,
  /** L0 request (local-api/client.ts:73) and the alias registry's HTTP bound. */
  request: 30_000,
  /** relayd's listing round. */
  listingRound: 10_000,
  /** The endpoint command timer (device-service-core device-service.ts) and the relay's drive idle bound. */
  endpointCommand: 120_000,
  /** The relay's fixed bound for observe, answer and thread records. */
  relayFixed: 30_000,
  /** The relay's drive ceiling. */
  relayCeiling: 1_800_000,
  /** The worker runner's stop for bootstrap (components/device-service/runner.ts). */
  bootstrapRunner: 600_000,
  /** The engine bridge's pause cap. */
  bridgePause: 600_000,
} as const

export const CONNECT_SLACK_MS = 2_000

export const DEADLINES = {
  service: 35_000,
  devices: 35_000,
  aliases: 35_000,
  sessionsList: 35_000,
  observeAttach: 32_000,
  observeRead: 35_000,
  drive: 125_000,
  close: 125_000,
  openEndpoint: 125_000,
  openLocate: 20_000,
  openAliasClaim: 35_000,
  openStep: 125_000,
  followTotal: 1_830_000,
  followProbeEvery: 30_000,
  followProbe: 15_000,
  attachOpen: 32_000,
  serveEndpoint: 5_000,
  bootstrap: 570_000,
  bridgeCap: 570_000,
} as const

type Outcome<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure

/**
 * Runs `work` under the member's deadline and the caller's signal, and always settles with data. L0 and L1 take no
 * AbortSignal, so a cancelled call detaches from `work` and answers `cancelled`; `mutating` marks a timeout or a
 * cancellation uncertain, since the request may already have changed the service.
 */
export function withinDeadline<T>(
  timers: Timers,
  opts: Opts | undefined,
  defaultMs: number,
  mutating: boolean,
  work: () => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  const uncertain = mutating ? { uncertain: true } : {}
  const signal = opts?.signal
  if (signal?.aborted === true)
    return Promise.resolve(
      remoteFailure("cancelled", "The call was cancelled before it started.", nextActionFor("cancelled")),
    )
  const deadlineMs = opts?.deadlineMs ?? defaultMs
  return new Promise<Outcome<T>>((resolve) => {
    let settled = false
    const settle = (outcome: Outcome<T>): void => {
      if (settled) return
      settled = true
      cancelTimer()
      signal?.removeEventListener("abort", onAbort)
      resolve(outcome)
    }
    const onAbort = (): void =>
      settle(remoteFailure("cancelled", "The call was cancelled.", nextActionFor("cancelled"), uncertain))
    const cancelTimer = timers.after(deadlineMs, () =>
      settle(
        remoteFailure("timeout", `No answer within ${deadlineMs} ms.`, nextActionFor("timeout"), {
          ...uncertain,
          details: { deadline_ms: deadlineMs },
        }),
      ),
    )
    signal?.addEventListener("abort", onAbort, { once: true })
    work().then(settle, (error: unknown) => settle(failureFromError(error, mutating)))
  })
}
