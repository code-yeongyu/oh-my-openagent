import { expect, test } from "bun:test"
import { runDetachedProbe } from "../rpc-host/detached-probe.test-support"

for (const scenario of ["site-2", "site-2-rejection", "site-4"]) {
  test(`#given ${scenario} disconnected client #when its background operation fails #then the process survives and logs the error`, async () => {
    // given / when
    const result = await runDetachedProbe(scenario)
    console.log(result.stdout.trim())

    // then
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
    expect(result.sandboxRemoved).toBe(true)
    const report = JSON.parse(result.stdout)
    expect(report).toMatchObject({ uncaughtException: 0, unhandledRejection: 0, finished: true })
    expect(report.logs).toContainEqual({
      message: scenario === "site-4" ? "senpi-task rpc detach failed" : "senpi-task heartbeat get_state failed",
      data: {
        taskId: "detached-probe",
        error: expect.stringContaining("the host session holds no connection"),
      },
    })
  }, 15_000)
}
