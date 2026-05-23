import { EventEmitter } from "node:events"

const TARGET_MAX_LISTENERS = 100

let raised = false

export function raiseEventEmitterLimit(target: number = TARGET_MAX_LISTENERS): void {
  if (raised) {
    return
  }
  raised = true

  if (EventEmitter.defaultMaxListeners < target) {
    EventEmitter.defaultMaxListeners = target
  }

  const proc = process as unknown as { setMaxListeners?: (n: number) => void; getMaxListeners?: () => number }
  if (typeof proc.setMaxListeners === "function") {
    const current = typeof proc.getMaxListeners === "function" ? proc.getMaxListeners() : 0
    if (current < target) {
      proc.setMaxListeners(target)
    }
  }
}

export function __resetRaisedFlagForTests(): void {
  raised = false
}
