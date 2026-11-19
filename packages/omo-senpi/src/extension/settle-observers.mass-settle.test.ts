import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import type { MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "./compose"
import { createMemoryJournalWiring } from "../components/memory/journal-wiring"

// omo#14351 fault injection, narrow slice. A mass wake of ~90 sessions runs the real
// journal-wiring settle path over real ~0.8 MB journals: the read-only delivery probe behind the
// storm must be admitted within a bound (deliveries never queue behind the storm), every journal
// stays exactly-once, and repeated settles of one session supersede instead of stacking.

const SESSIONS = 90
const ROWS_PER_JOURNAL = 4000
const DELIVERY_ADMISSION_BOUND_MS = 400

function branchEntriesFor(sessionRows: number): unknown[] {
  const entries: unknown[] = [{ type: "message", id: "seed-user", message: { role: "user", content: "seed" } }]
  for (let index = 0; index < sessionRows; index += 1) {
    entries.push({
      type: "message",
      id: `assistant-${index}`,
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(120) }] },
    })
  }
  return entries
}

function contextFor(sessionId: string, entries: readonly unknown[]): unknown {
  return { sessionManager: { getSessionId: () => sessionId, getBranch: () => entries } }
}

test("#given a 90-session storm over real steady-state journals #when a delivery probe settles behind it #then the probe is admitted within the bound and every journal stays exactly-once", async () => {
  const transcriptsRoot = await mkdtemp(join(tmpdir(), "mass-settle-14351-"))
  const identityPaths = { transcripts: transcriptsRoot } as MemoryIdentityPaths
  const pi = new FakeExtensionAPI()
  const wiring = createMemoryJournalWiring({ identityPaths })
  wiring.register(pi)

  const sessionIds = Array.from({ length: SESSIONS }, (_, index) => `session-${index}`)
  const branches = new Map(sessionIds.map((id) => [id, branchEntriesFor(ROWS_PER_JOURNAL)]))
  for (const id of sessionIds) {
    await pi.dispatch("agent_settled", { type: "agent_settled" }, contextFor(id, branches.get(id) ?? []))
  }

  const probeAdmittedAt: number[] = []
  pi.on("agent_settled", async () => {
    probeAdmittedAt.push(performance.now())
  })

  const stormDispatches = sessionIds.map((id) =>
    pi.dispatch("agent_settled", { type: "agent_settled" }, contextFor(id, branches.get(id) ?? [])),
  )
  const probeStart = performance.now()
  const probeDispatch = pi.dispatch("agent_settled", { type: "agent_settled" }, contextFor("probe", []))

  await probeDispatch
  const probeAdmissionMs = probeAdmittedAt[0] - probeStart
  expect(probeAdmissionMs).toBeLessThan(DELIVERY_ADMISSION_BOUND_MS)

  const results = await Promise.all(stormDispatches)
  expect(results.every((result) => (result as { appended: number }).appended === 0)).toBe(true)

  const probeAgain = await pi.dispatch("agent_settled", { type: "agent_settled" }, contextFor("session-0", branches.get("session-0") ?? []))
  expect((probeAgain as { appended: number; skipped: number }).skipped).toBeGreaterThan(0)
})

test("#given repeated settles of one session through the observer seam #when a newer settle replaces an in-flight one #then only the newest completes and the superseded are skipped and logged", async () => {
  const pi = new FakeExtensionAPI()
  const seenTurns: number[] = []
  const skipLogs: unknown[] = []
  await composeOmoSenpiExtension(
    [
      {
        name: "supersede",
        register(api) {
          api.on(
            "agent_settled",
            async (payload, _ctx, observer) => {
              for (let phase = 0; phase < 3; phase += 1) {
                await new Promise((resolve) => setImmediate(resolve))
                observer?.signal.throwIfAborted()
              }
              seenTurns.push((payload as { turn: number }).turn)
            },
            { hookLabel: "supersede.work" },
          )
        },
      },
    ],
    {
      logger: {
        info() {},
        error() {},
        warn: (_message, details) => {
          skipLogs.push(details)
        },
      },
    },
  )(pi)

  const dispatches = [1, 2, 3].map((turn) =>
    pi.dispatch(
      "agent_settled",
      { type: "agent_settled", turn },
      contextFor(`supersede-session`, []),
    ),
  )
  const results = await Promise.all(dispatches)

  expect(seenTurns).toEqual([3])
  expect(results.every((result) => result === undefined || result === null)).toBe(true)
  expect(skipLogs.length).toBe(2)
  await pi.dispatch("session_shutdown", {})
})
