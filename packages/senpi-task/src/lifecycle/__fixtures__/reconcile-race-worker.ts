import { appendFileSync, readSync } from "node:fs"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import type { ManagedChildHandle } from "../../manager/child-handle"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import { createTaskLifecycle } from "../create"

const [projectDir, parentSessionId, launchLog] = process.argv.slice(2)
if (projectDir === undefined || parentSessionId === undefined || launchLog === undefined) {
  throw new Error("usage: reconcile-race-worker <projectDir> <parentSessionId> <launchLog>")
}

const backing = createTaskRecordStore({ project_dir: projectDir, task: { state_dir: projectDir } })
let firstList = true
const store: TaskRecordStore = {
  ...backing,
  list: () => {
    const snapshot = backing.list()
    if (firstList) {
      firstList = false
      process.stdout.write("scanned\n")
      const signal = Buffer.alloc(1)
      readSync(0, signal, 0, 1, null)
    }
    return snapshot
  },
}

const lifecycle = createTaskLifecycle({
  store,
  registry: {
    get: () => undefined,
    entries: () => [],
    forget: () => undefined,
    hasPendingSends: () => false,
  },
  config: OmoTaskSettingsSchema.parse({}),
  hostPid: process.pid,
  signaller: {
    isAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    signal: () => undefined,
  },
  respawn: async (record) => {
    appendFileSync(launchLog, `${process.pid}:${record.task_id}\n`)
    const handle: ManagedChildHandle = {
      task_id: record.task_id,
      sessionId: `race-${process.pid}`,
      pid: undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: () => () => undefined,
      waitForOutcome: () => new Promise(() => undefined),
      lastAssistantText: () => undefined,
      dispose: async () => undefined,
    }
    return { ok: true, handle }
  },
  reattach: async () => ({ ok: true }),
})

const result = await lifecycle.reconcileOnSessionStart(parentSessionId)
process.stdout.write(`${JSON.stringify(result)}\n`)
const exitSignal = Buffer.alloc(1)
readSync(0, exitSignal, 0, 1, null)
