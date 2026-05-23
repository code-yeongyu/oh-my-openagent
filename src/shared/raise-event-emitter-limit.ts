import { EventEmitter } from "node:events"

const TARGET_MAX_LISTENERS = 100

let raised = false

export function raiseEventEmitterLimit(target: number = TARGET_MAX_LISTENERS): void {
  if (raised) {
    return
  }
  raised = true

  // EventEmitter.defaultMaxListeners === 0 means "unlimited" in Node's API.
  // Treat that as already-covered so a host that explicitly disabled the warning
  // is not silently downgraded to `target`.
  const currentDefault = EventEmitter.defaultMaxListeners
  if (currentDefault !== 0 && currentDefault < target) {
    EventEmitter.defaultMaxListeners = target
  }

  if (typeof process.setMaxListeners === "function") {
    // Same "0 = unlimited" semantics on `process` itself. If `getMaxListeners`
    // is unavailable, skip the raise rather than assume 0 and unconditionally
    // overwrite the host's configuration.
    if (typeof process.getMaxListeners === "function") {
      const current = process.getMaxListeners()
      if (current !== 0 && current < target) {
        process.setMaxListeners(target)
      }
    }
  }
}

export function __resetRaisedFlagForTests(): void {
  raised = false
}
