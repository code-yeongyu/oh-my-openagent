// Cold-boot probe for the pi-tui warm-up in createTaskComponent().register().
//
// Executed by register-warms-pi-tui.test.ts in a FRESH bun process on purpose: both bunfig test
// preloads (root test-setup.ts and packages/senpi-task/test-support/warm-lazy-runtime.ts) call
// loadPiTui() before any test body runs, so a probe living inside the test process would pass no
// matter what the component does. `bun run` ignores `[test] preload`, so this file boots with the
// pi-tui boundary genuinely cold.
//
// The scenario is issue #7339: composeOmoSenpiExtension lives in the omo.js bundle while every
// synchronous piTui() consumer of the task surface lives in the separately-bundled omo-task.js, so
// compose's warm-up cannot warm the copy the task runtime actually reads. The task component's own
// register() must therefore warm the boundary BEFORE anything can render. This probe registers ONLY
// createTaskComponent (compose is never imported), then drives the exact crash chain from the
// issue: a store mutation schedules the debounced status-widget update, the timer fires, and the
// row formatting helpers read pi-tui synchronously.
import { createTaskRecord, excerptRendererText, type ListedTask, type TaskRecord } from "@oh-my-opencode/senpi-task"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { loadSenpiOmoConfig } from "../../config-resolution"
import type { ComponentContext, ComponentLogger } from "../../../extension/types"
import { createTaskComponent } from "../index"
import { createTaskStatusUi, type StatusUiManager, type StatusUiRuntime, type StatusUiTimers } from "../status-ui"

type ProbeResult = {
  readonly coldBeforeRegister: boolean
  readonly widgetRendered: boolean
  readonly error?: string
}

const silentLogger: ComponentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function isolatedLoadConfig(): ReturnType<typeof loadSenpiOmoConfig> {
  const sandbox = mkdtempSync(join(tmpdir(), "omo-7339-probe-config-"))
  return loadSenpiOmoConfig({ cwd: sandbox, env: { HOME: sandbox, USERPROFILE: sandbox } })
}

function completedWorkerRecord(parentSessionId: string): TaskRecord {
  return {
    ...createTaskRecord({
      parent_session_id: parentSessionId,
      root_session_id: parentSessionId,
      name: "worker",
      depth: 1,
      execution_mode: "in-process",
      model: "anthropic/claude-fable-5",
      notify_on_terminal: false,
    }),
    status: "running",
  }
}

function statusUiFixtures(record: TaskRecord): {
  manager: StatusUiManager
  runtime: StatusUiRuntime
  timers: StatusUiTimers
  widgetRows: { value: unknown }
  firePendingOnce: () => void
} {
  const listed: readonly ListedTask[] = [{ record }]
  const manager: StatusUiManager = {
    list: () => listed,
    wasBackground: (taskId) => taskId === record.task_id,
  }
  const widgetRows = { value: undefined as unknown }
  const runtime: StatusUiRuntime = {
    ui: () => ({
      setWidget: (_key: string, rows: unknown) => {
        widgetRows.value = rows
      },
      notify: () => {},
      setStatus: () => {},
      select: async () => undefined,
      confirm: async () => false,
    }),
    sessionId: () => record.parent_session_id,
    mode: () => "tui",
  }
  // The production debounce timer is exactly where the host died (Timeout._onTimeout in the issue
  // stack), so the probe captures the scheduled callback and fires ONE tick by hand: a throw on
  // that path propagates synchronously instead of killing the process as an uncaught exception.
  const scheduled: Array<() => void> = []
  const timers: StatusUiTimers = {
    set: (callback) => {
      scheduled.push(callback)
      return scheduled.length - 1
    },
    clear: () => {},
  }
  const firePendingOnce = (): void => {
    const callback = scheduled.at(-1)
    if (callback === undefined) throw new Error("no debounced render was scheduled")
    callback()
  }
  return { manager, runtime, timers, widgetRows, firePendingOnce }
}

async function main(): Promise<ProbeResult> {
  // Proves the process really started cold; without this the later assertion could be satisfied by
  // an unnoticed preload rather than by the component's own warm-up. excerptRendererText is the
  // same renderer-text -> piTui() path the status widget rows take.
  let coldBeforeRegister = false
  try {
    excerptRendererText("cold", 10)
  } catch {
    coldBeforeRegister = true
  }

  const pi = new FakeExtensionAPI()
  const component = createTaskComponent({ loadConfig: isolatedLoadConfig })
  const ctx: ComponentContext = { logger: silentLogger, config: { getFlag: (name: string) => pi.getFlag(name) } }
  await component.register(pi, ctx)

  try {
    const record = completedWorkerRecord("probe-session")
    const { manager, runtime, timers, widgetRows, firePendingOnce } = statusUiFixtures(record)
    const statusUi = createTaskStatusUi({ manager, runtime, timers })
    statusUi.scheduleSync()
    firePendingOnce()
    return { coldBeforeRegister, widgetRendered: widgetRows.value !== undefined }
  } catch (error) {
    return {
      coldBeforeRegister,
      widgetRendered: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

console.log(JSON.stringify(await main()))
