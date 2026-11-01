import type { ManagedChildEvent, ManagedChildHandle, RunnerOutcome } from "./child-handle"
import type { UsageLimitProbe } from "./usage-limit-memory"
import { PROBE_REQUEST_EVENT } from "../runners/probe-request"

function answered(event: ManagedChildEvent): boolean {
  if (event.type === "message_update") return true
  if (event.type !== "message_end" || typeof event.message !== "object" || event.message === null) return false
  const message = event.message as { readonly role?: unknown; readonly stopReason?: unknown }
  return message.role === "assistant" && message.stopReason !== "error"
}

/**
 * The outcome of the one same-provider rung an ambiguous usage limit hopped onto (#11383), bounded: a rung that has
 * not started answering within `timeoutMs` fails with the original limit plus the timeout, so a silent probe confirms
 * the provider's account limit instead of holding the task until the reset. `onAnswered` fires once the rung starts
 * answering, so its later failures are its own.
 */
export function boundedProbeOutcome(input: {
  readonly handle: ManagedChildHandle
  readonly probe: UsageLimitProbe
  readonly model: string
  readonly timeoutMs: number
  readonly onAnswered: () => void
  readonly scheduleTimeout?: (run: () => void, delayMs: number) => { cancel(): void }
  readonly subscribeRequest?: (listener: (at: number) => void) => () => void
  readonly now?: () => number
}): Promise<RunnerOutcome> {
  return new Promise((resolve, reject) => {
    let timer: { cancel(): void } | undefined
    let unsubscribe = (): void => {}
    let unsubscribeRequest = (): void => {}
    let stopped = false
    const stop = (): void => {
      stopped = true
      unsubscribe()
      unsubscribeRequest()
    }
    const schedule = input.scheduleTimeout ?? ((run, delayMs) => {
      const timeout = setTimeout(run, delayMs)
      timeout.unref?.()
      return { cancel: () => clearTimeout(timeout) }
    })
    const start = (at?: number): void => {
      if (!stopped && timer === undefined) {
        timer = schedule(() => {
          stop()
          resolve({
            status: "error",
            failure: {
              kind: "child-unresponsive",
              message: `${input.probe.message}\n${input.model} gave no answer within ${Math.ceil(input.timeoutMs / 1000)} s after that limit, so the ${input.probe.provider} limit counts as account-wide.`,
            },
          })
        }, Math.max(0, input.timeoutMs - (at === undefined ? 0 : (input.now ?? Date.now)() - at)))
      }
    }
    unsubscribe = input.handle.subscribe((event) => {
      if (event.type === "extension_event" && Reflect.get(event, "name") === PROBE_REQUEST_EVENT) {
        const data: unknown = Reflect.get(event, "data")
        const at: unknown = typeof data === "object" && data !== null ? Reflect.get(data, "at") : undefined
        start(typeof at === "number" ? at : undefined)
      }
      if (!answered(event)) return
      timer?.cancel()
      stop()
      input.onAnswered()
    })
    if (stopped) unsubscribe()
    unsubscribeRequest = input.subscribeRequest?.(start) ?? (() => {})
    if (stopped) unsubscribeRequest()
    void input.handle.waitForOutcome().then(
      (outcome) => {
        timer?.cancel()
        stop()
        resolve(outcome)
      },
      (error: unknown) => {
        timer?.cancel()
        stop()
        reject(error)
      },
    )
  })
}
