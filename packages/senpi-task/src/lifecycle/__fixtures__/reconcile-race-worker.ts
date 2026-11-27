import { appendFileSync, readSync } from "node:fs"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import type { ManagedChildHandle } from "../../manager/child-handle"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import { createTaskLifecycle } from "../create"
import { NO_HOST_ENDPOINT } from "../host-session"

const [projectDir, parentSessionId, launchLog, gate] = process.argv.slice(2)
if (
  projectDir === undefined ||
  parentSessionId === undefined ||
  launchLog === undefined ||
  (gate !== undefined && gate !== "hold-probe" && gate !== "hold-claim")
) {
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

// Machine-readable lose-point report (omo#11682): the record's ownership fields at each barrier and
// how many record mutations this worker made in total. The test asserts each forced row's lose-point
// from this report, so a future store.mutate added before the CAS moves the barrier and fails the row.
type Observation = {
  readonly host_pid: number | undefined
  readonly residency_state: string
  readonly residency_claim: string | undefined
  readonly updated_at: string
  readonly run_epoch: number
}
const observe = (record: ReturnType<TaskRecordStore["load"]>): Observation | undefined =>
  record === null
    ? undefined
    : {
        host_pid: record.host_pid,
        residency_state: record.residency_state,
        residency_claim: record.residency_claim,
        updated_at: record.updated_at,
        run_epoch: record.notification.run_epoch,
      }

let scannedTaskId: string | undefined
const lists: Observation[] = []
let scanObservation: Observation | undefined
let probeObservation: Observation | undefined
let claimBefore: Observation | undefined
let claimAfter: Observation | undefined
let mutateCount = 0
let heldClaimInFlight = false

const store: TaskRecordStore = {
  ...backing,
  list: () => {
    const snapshot = backing.list()
    if (firstList) {
      firstList = false
      barrier("started")
      scannedTaskId = snapshot.records.find((record) => record.parent_session_id === parentSessionId)?.task_id
    }
    const own = snapshot.records.find((record) => record.parent_session_id === parentSessionId)
    lists.push(observe(own ?? null) as Observation)
    scanObservation = lists[lists.length - 1]
    return snapshot
  },
  mutate: (taskId, mutation) => {
    mutateCount += 1
    if (holdClaim) {
      holdClaim = false
      heldClaimInFlight = true
      claimBefore = observe(backing.load(taskId))
      barrier("claiming")
    }
    const result = backing.mutate(taskId, mutation)
    if (heldClaimInFlight) {
      heldClaimInFlight = false
      claimAfter = observe(backing.load(taskId))
    }
    return result
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
        probeObservation = observe(scannedTaskId === undefined ? null : backing.load(scannedTaskId))
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
process.stdout.write(
  `${JSON.stringify({
    ...result,
    report: {
      scan: scanObservation,
      lists,
      probe: probeObservation,
      claim: claimBefore === undefined ? undefined : { before: claimBefore, after: claimAfter },
      mutateCount,
    },
  })}\n`,
)
const exitSignal = Buffer.alloc(1)
readSync(0, exitSignal, 0, 1, null)
