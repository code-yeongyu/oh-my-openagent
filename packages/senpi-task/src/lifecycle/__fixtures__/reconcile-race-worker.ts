import { appendFileSync, readSync } from "node:fs"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import type { ManagedChildHandle } from "../../manager/child-handle"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import { createTaskLifecycle } from "../create"
import { NO_HOST_ENDPOINT } from "../host-session"

const [projectDir, parentSessionId, launchLog, gate] = process.argv.slice(2)
if (projectDir === undefined || parentSessionId === undefined || launchLog === undefined
  || (gate !== undefined && gate !== "hold-probe" && gate !== "hold-claim")) {
  throw new Error("usage: reconcile-race-worker <projectDir> <parentSessionId> <launchLog> [hold-probe|hold-claim]")
}

// Each barrier announces itself on stdout, then blocks until the test writes one byte to stdin.
function barrier(name: string): void {
  process.stdout.write(`${name}\n`)
  readSync(0, Buffer.alloc(1), 0, 1, null)
}

const backing = createTaskRecordStore({ project_dir: projectDir, task: { state_dir: projectDir } })
let firstList = true
// `hold-probe` parks this worker inside its owner-liveness probe, after reconcile scanned the
// record and before it re-reads ownership. `hold-claim` parks it after that re-read, right before
// its first record mutation: the ownership CAS. The test lands the other worker's claim there.
let holdProbe = gate === "hold-probe"
let holdClaim = gate === "hold-claim"
const store: TaskRecordStore = {
  ...backing,
  list: () => {
    const snapshot = backing.list()
    if (firstList) {
      firstList = false
      barrier("started")
    }
    return snapshot
  },
  mutate: (taskId, mutation) => {
    if (holdClaim) {
      holdClaim = false
      barrier("claiming")
    }
    return backing.mutate(taskId, mutation)
  },
}

const lifecycle = createTaskLifecycle({
  hostEndpoint: NO_HOST_ENDPOINT,
  store,
  registry: {
    get: () => undefined,
    entries: () => [],
    forget: (_taskId, _options) => undefined,
    hasPendingSends: () => false,
  },
  config: OmoTaskSettingsSchema.parse({}),
  hostPid: process.pid,
  signaller: {
    isAlive: (pid) => {
      if (holdProbe && pid !== process.pid) {
        holdProbe = false
        barrier("probing")
      }
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
