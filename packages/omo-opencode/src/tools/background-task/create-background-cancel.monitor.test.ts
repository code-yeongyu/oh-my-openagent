import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { BackgroundManager } from "../../features/background-agent"
import type { MonitorManager, MonitorRecord } from "../../features/monitor/types"
import { createBackgroundCancel } from "./create-background-cancel"

function monitorRecord(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return unsafeTestValue<MonitorRecord>({
    id: "mon_1",
    label: "errors in deploy.log",
    parentSessionId: "ses_parent",
    status: "running",
    counters: { matchedLines: 4 },
    ...overrides,
  })
}

const backgroundManager = unsafeTestValue<BackgroundManager>({
  getTask: () => undefined,
  getAllDescendantTasks: () => [],
})
const context = unsafeTestValue({ sessionID: "ses_parent" })

describe("background_cancel with a monitor id", () => {
  test("#given a running monitor of this session #when its id is cancelled #then the monitor is stopped", async () => {
    // given
    const stop = mock(async () => {})
    const monitors = unsafeTestValue<MonitorManager>({ get: () => monitorRecord(), stop, list: () => [] })
    const cancel = createBackgroundCancel(backgroundManager, unsafeTestValue({}), monitors)

    // when
    const result = await cancel.execute({ taskId: "mon_1" }, context)

    // then
    expect(stop).toHaveBeenCalledWith("mon_1")
    expect(result).toContain("Monitor stopped")
  })

  test("#given another session's monitor #when its id is cancelled #then it is left running", async () => {
    // given
    const stop = mock(async () => {})
    const monitors = unsafeTestValue<MonitorManager>({
      get: () => monitorRecord({ parentSessionId: "ses_other" }),
      stop,
      list: () => [],
    })
    const cancel = createBackgroundCancel(backgroundManager, unsafeTestValue({}), monitors)

    // when
    const result = await cancel.execute({ taskId: "mon_1" }, context)

    // then
    expect(stop).not.toHaveBeenCalled()
    expect(result).toContain("not found")
  })

  test("#given all=true #when cancelling #then the session's running monitors are stopped too", async () => {
    // given
    const stop = mock(async () => {})
    const monitors = unsafeTestValue<MonitorManager>({
      get: () => undefined,
      stop,
      list: () => [monitorRecord(), monitorRecord({ id: "mon_2", status: "exited" })],
    })
    const cancel = createBackgroundCancel(backgroundManager, unsafeTestValue({}), monitors)

    // when
    const result = await cancel.execute({ all: true }, context)

    // then
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith("mon_1")
    expect(result).toContain("Stopped 1 monitor(s)")
  })

  test("#given an id that is neither a task nor a monitor #when cancelled #then it is reported as not found", async () => {
    const monitors = unsafeTestValue<MonitorManager>({
      get: () => undefined,
      stop: mock(async () => {}),
      list: () => [],
    })
    const cancel = createBackgroundCancel(backgroundManager, unsafeTestValue({}), monitors)
    expect(await cancel.execute({ taskId: "mon_missing" }, context)).toContain("not found")
  })
})
