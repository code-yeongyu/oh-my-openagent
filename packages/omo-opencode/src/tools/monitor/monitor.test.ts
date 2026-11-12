import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { MonitorManager, MonitorStartOpts } from "../../features/monitor/types"
import { DEFAULT_MONITOR_TIMEOUT_MS, createMonitorTool } from "./monitor"

function createManager(starts: MonitorStartOpts[]): MonitorManager {
  return unsafeTestValue<MonitorManager>({
    start: mock(async (opts: MonitorStartOpts) => {
      starts.push(opts)
      return {
        id: "mon_1",
        label: opts.label,
        timeoutMs: opts.timeoutMs,
        outputFile: "/tmp/omo-monitor/ses/mon_1.output",
        status: "running",
        eventsDelivered: 0,
      }
    }),
  })
}

const context = (ask?: () => Promise<void>) =>
  unsafeTestValue({ sessionID: "ses_parent", messageID: "msg_1", ...(ask ? { ask } : {}) })

describe("monitor tool", () => {
  test("#given no timeout_ms #when started #then it watches for the 5 minute default under the parent, labelled by its description", async () => {
    // given
    const starts: MonitorStartOpts[] = []
    const monitor = createMonitorTool(createManager(starts), { monitor: { enabled: true } })

    // when
    const result = await monitor.execute(
      { description: "errors in deploy.log", command: "tail -f deploy.log" },
      context(async () => {}),
    )

    // then
    expect(starts).toEqual([
      expect.objectContaining({
        label: "errors in deploy.log",
        parentSessionId: "ses_parent",
        timeoutMs: DEFAULT_MONITOR_TIMEOUT_MS,
      }),
    ])
    expect(result).toContain("mon_1")
    expect(result).toContain("/tmp/omo-monitor/ses/mon_1.output")
    expect(result).toContain('background_cancel(taskId="mon_1")')
  })

  test("#given the bash permission is refused #when started #then nothing runs", async () => {
    // given
    const starts: MonitorStartOpts[] = []
    const monitor = createMonitorTool(createManager(starts), { monitor: { enabled: true } })

    // when
    const result = await monitor.execute(
      { description: "d", command: "rm -rf x" },
      context(async () => {
        throw new Error("denied")
      }),
    )

    // then
    expect(result).toContain("[ERROR] monitor denied")
    expect(starts).toEqual([])
  })
})
