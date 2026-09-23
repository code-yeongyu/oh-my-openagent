import { expect, spyOn, test } from "bun:test"
import { runDetachedProbe } from "./detached-probe.test-support"
import { createHostSessionHandle } from "./handle"
import { FAKE_SESSION, fakeSessionPort } from "./handle.test-support"

for (const scenario of ["site-1", "site-1-rejection", "site-3", "site-3-close"]) {
  test(`#given ${scenario} detached session #when its background operation fails #then the process survives and logs the error`, async () => {
    // given / when: the standalone process installs its counters before triggering the operation.
    const result = await runDetachedProbe(scenario)
    console.log(result.stdout.trim())

    // then
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
    expect(result.sandboxRemoved).toBe(true)
    const report = JSON.parse(result.stdout)
    expect(report).toMatchObject({ uncaughtException: 0, unhandledRejection: 0, finished: true })
    expect(report.logs).toContainEqual({
      message: scenario.startsWith("site-1")
        ? "senpi-task host session heartbeat get_state failed"
        : "senpi-task host session teardown step failed",
      data: {
        taskId: "detached-probe",
        ...(scenario.startsWith("site-1") ? {} : { step: scenario === "site-3" ? "abort" : "close_session" }),
        error: expect.stringContaining("the host session holds no connection"),
      },
    })
  }, 15_000)
}

test("#given site-1 close is pending #when close detaches the client #then its heartbeat was already stopped", async () => {
  // given: observe the real interval's cancellation at the exact point close drops the connection.
  const intervals = spyOn(globalThis, "setInterval")
  const clears = spyOn(globalThis, "clearInterval")
  const release = Promise.withResolvers<void>()
  let stoppedBeforeClose = false
  const port = {
    ...fakeSessionPort(),
    close: () => {
      const timer = intervals.mock.results[0]?.value
      stoppedBeforeClose = timer !== undefined && clears.mock.calls.some(([id]) => id === timer)
      return release.promise
    },
  }
  const handle = createHostSessionHandle({
    client: port, session: FAKE_SESSION, taskId: "pending-close",
    heartbeatIntervalMs: 60_000, now: () => 7, closeGraceMs: 60_000,
  })

  // when
  const closing = handle.close()
  try {
    // then: the reply is still withheld; cancellation must not depend on it.
    expect(stoppedBeforeClose).toBe(true)
    expect(handle.hasExited()).toBe(false)
  } finally {
    release.resolve()
    await closing
    await handle.dispose()
    intervals.mockRestore()
    clears.mockRestore()
  }
})
