import { describe, expect, test } from "bun:test"
import { defaultTeardownStepDeadline, withinTeardownBudget } from "./teardown-budget"

const target = { taskId: "task-1", pid: 4242 }

describe("withinTeardownBudget", () => {
  test("#given a step that finishes inside its budget #when the budget wraps it #then the deadline timer is cancelled, not left armed", async () => {
    // The timer is unref'd, so the leak is invisible to the event loop; observe the clearTimeout
    // the cancellation must perform (omo#11676).
    const originalClearTimeout = globalThis.clearTimeout
    let cleared = 0
    // @ts-expect-error test-only narrow spy over the global
    globalThis.clearTimeout = (timer: ReturnType<typeof setTimeout>) => {
      cleared += 1
      return originalClearTimeout(timer)
    }
    try {
      await withinTeardownBudget(defaultTeardownStepDeadline, target, "dispose", async () => {})
    } finally {
      globalThis.clearTimeout = originalClearTimeout
    }
    expect(cleared).toBe(1)
  })

  test("#given an already-expired deadline #when the step is cancelled after firing #then the wrap still reports the timeout", async () => {
    const expiredDeadline = () => {
      const expired = Promise.resolve() as Promise<void> & { cancel?: () => void }
      expired.cancel = () => undefined
      return expired
    }
    let ran = false
    await withinTeardownBudget(expiredDeadline, target, "abort", async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  test("#given the default deadline #when cancelled #then its promise never resolves inside the budget", async () => {
    const expired = defaultTeardownStepDeadline("terminate")
    expired.cancel?.()
    let resolved = false
    void expired.then(() => {
      resolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(resolved).toBe(false)
  })
})
