import { afterEach, expect, test } from "bun:test"

import { resolveContext } from "./context"
import { NO_HOST_ENDPOINT } from "./host-session"
import type { ProcessSignaller } from "./port"
import { reviveClaimed } from "./reconcile-reclamation"
import { FakeRegistry, cleanupProjects, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const hostPid = 4242
const signaller: ProcessSignaller = { isAlive: () => false, signal: () => undefined }

// The row reads this reason back as "revival deferred: <reason>", so a child its own run paused must
// never be reported as held by some other live owner.
test("#given a run Stop pauses a child while this host's revival holds its claim #when the revival checks the claim #then it defers as run_paused, not foreign_live_owner", async () => {
  // given
  const store = tempStore()
  const claimed = seedRecord(store, {
    task_id: "st_30000a01", status: "running", residency_state: "resident", execution_mode: "in-process", host_pid: hostPid,
  })
  store.replace({ ...claimed, residency_claim: "claim-1" })
  const held = store.load(claimed.task_id)
  if (held === null) throw new Error("seeded record vanished")
  store.transition(held.task_id, { type: "pause", timestamp: new Date(9_000_000).toISOString() })
  const context = resolveContext({
    hostEndpoint: NO_HOST_ENDPOINT, store, registry: new FakeRegistry(), config: settings(), hostPid, now: () => 9_000_000, signaller, orphanKillDelayMs: 0,
  })

  // when
  const outcome = await reviveClaimed(context, held, "persisted_only", undefined)

  // then
  expect(outcome).toMatchObject({ task_id: held.task_id, kind: "deferred", reason: "run_paused" })
})

// The same holds for a Stop that lands during the respawn itself, after every earlier check passed.
test("#given a run Stop pauses a child while its respawn is in flight #when the respawn returns #then the revival defers as run_paused, not foreign_live_owner", async () => {
  // given
  const store = tempStore()
  const claimed = seedRecord(store, {
    task_id: "st_30000a02", status: "running", residency_state: "resident", execution_mode: "in-process", host_pid: hostPid,
  })
  store.replace({ ...claimed, residency_claim: "claim-2" })
  const held = store.load(claimed.task_id)
  if (held === null) throw new Error("seeded record vanished")
  const context = resolveContext({
    hostEndpoint: NO_HOST_ENDPOINT, store, registry: new FakeRegistry(), config: settings(), hostPid, now: () => 9_000_000, signaller, orphanKillDelayMs: 0,
    respawn: async (record) => {
      store.transition(record.task_id, { type: "pause", timestamp: new Date(9_000_000).toISOString() })
      return { ok: false, disposition: "retryable", code: "session_unavailable", reason: "stopped mid-respawn" }
    },
    reattach: async () => ({ ok: true }),
  })

  // when
  const outcome = await reviveClaimed(context, held, "persisted_only", "/sessions/child.jsonl")

  // then
  expect(outcome).toMatchObject({ task_id: held.task_id, kind: "deferred", reason: "run_paused" })
})
