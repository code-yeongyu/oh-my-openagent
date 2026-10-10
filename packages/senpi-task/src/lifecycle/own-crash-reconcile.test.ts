import { afterEach, expect, test } from "bun:test"

import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { exitedTask } from "../manager/__fixtures__/provisional-exit"

afterEach(cleanupProjects)

test("a genuine child exit before parent death stays error after reconciliation", async () => {
  // Given an independent process.exit(1), observed and persisted by the real manager.
  const f = await exitedTask()
  try {
    const settled = f.manager.waitFor(f.taskId)
    f.clock.advance(2_000)
    const failed = await settled
    expect(failed.status).toBe("error")
    // When the parent subsequently dies and a new session reconciles the persisted child.
    f.manager.forget(f.taskId)
    await f.lifecycle.reconcileOnSessionStart("new-parent")
    const reconciled = f.store.load(f.taskId)
    // Then the failure and its identity survive; no loss event is fabricated.
    expect(reconciled?.status).toBe("error")
    expect(reconciled?.error_message).toBe(failed?.error_message)
    expect(reconciled?.notification.run_epoch).toBe(failed?.notification.run_epoch)
    expect(f.events()).not.toContain("reconcile_lost")
  } finally {
    f.dispose()
  }
})
