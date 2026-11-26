// @ts-check
// signal and deadline_ms of the install calls that can wait (design 4.4, slice C1c, #14960): one signal that aborts
// when the caller's does (cancelled) or once deadline_ms has passed on the clock the call is given (timeout), and the
// typed failure each answers with. A call checks the signal before it writes anything and between its stages, and
// races every wait on it, so a stage that never resolves still ends.

import { failure } from "./install-result.js"

/**
 * @typedef {{ readonly signal?: AbortSignal, readonly deadline_ms?: number }} WaitOptions
 * @typedef {(ms: number, fire: () => void) => () => void} After
 */

/** @type {After} */
const realAfter = (ms, fire) => {
  const timer = setTimeout(fire, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/** Why a call stopped: its caller's signal fired, or its deadline passed. */
class Aborted extends Error {
  /** @param {"cancelled" | "timeout"} reason @param {number | undefined} deadline */
  constructor(reason, deadline) {
    super(reason === "cancelled" ? "the call was cancelled" : `deadline_ms (${deadline}) passed`)
    this.reason = reason
    this.deadline = deadline
  }
}

/**
 * The call's one signal, and `done` to stop listening once the call settles.
 * @param {WaitOptions} [options] @param {After} [after] the clock deadline_ms is measured on
 */
export function waitOn(options = {}, after = realAfter) {
  const controller = new AbortController()
  /** @type {(() => void)[]} */
  const stops = []
  /** @param {"cancelled" | "timeout"} reason */
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(new Aborted(reason, options.deadline_ms))
  }
  const caller = options.signal
  if (caller?.aborted) abort("cancelled")
  else if (caller !== undefined) {
    const cancel = () => abort("cancelled")
    caller.addEventListener("abort", cancel, { once: true })
    stops.push(() => caller.removeEventListener("abort", cancel))
  }
  if (options.deadline_ms !== undefined) stops.push(after(options.deadline_ms, () => abort("timeout")))
  return {
    signal: controller.signal,
    done: () => {
      for (const stop of stops) stop()
    },
  }
}

/** @param {AbortSignal} signal */
export function stopIfAborted(signal) {
  if (signal.aborted) throw signal.reason
}

/**
 * `promise`, or the signal's reason as soon as it aborts, whichever comes first: a wait that never settles still ends.
 * @template T @param {Promise<T> | T} promise @param {AbortSignal} signal @returns {Promise<T>}
 */
export function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const stop = () => reject(signal.reason)
    signal.addEventListener("abort", stop, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", stop)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", stop)
        reject(error)
      },
    )
  })
}

/**
 * The typed failure of a call that stopped: cancelled, or timeout with the deadline; undefined for any other error.
 * @param {unknown} error @param {Record<string, unknown>} [details] what the call left behind
 */
export function abortedAnswer(error, details = {}) {
  if (!(error instanceof Aborted)) return undefined
  return error.reason === "cancelled"
    ? failure("cancelled", error.message, "Call it again if it is still wanted.", details)
    : failure("timeout", error.message, "Retry the call; if it changes something, read the current state first.", {
        deadline_ms: error.deadline,
        ...details,
      })
}
