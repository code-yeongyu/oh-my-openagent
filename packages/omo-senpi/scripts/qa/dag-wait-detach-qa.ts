#!/usr/bin/env bun
// Live QA for the dag tool's monitor-style wait detach. Drives the REAL surfaces end to end: a
// real on-disk DagFileStore, the real DagManager, the real createDagWaitSurface (durable journal
// subscription included), the real runDagTool, and the real IdleInjectionCoordinator + createDagWake
// pair with its production flush window. No senpi spawn: same precedent as dag-gate-proof.ts and
// dag-paused-header-qa.ts - the engine and adapter composition ARE the real surface here.
// Writes the captured report to <out-dir>/dag-wait-detach-qa.json and exits non-zero on violation.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDagSchedulerEvent,
  compileDag,
  createDagFileStore,
  createDagJournal,
  createDagManager,
  createDagWaitSurface,
  type DagDefinition,
  type DagRunId,
  type DagRunRecordV1,
} from "@oh-my-opencode/senpi-task/dag"

import { IdleInjectionCoordinator } from "../../src/extension/idle-injection-coordinator"
import { runDagTool, type DagToolResult } from "../../src/components/task/dag-tool"
import { createDagWake } from "../../src/components/task/dag-wake"

const PARENT_SESSION = "session-detach-qa"
const ROOT_SESSION = "session-detach-qa"
const RUN_ID = "run-wait-detach" as DagRunId
const RUN_NAME = "wait detach qa"

const outDir = process.argv[2] ?? join(tmpdir(), "dag-wait-detach-qa")
const failures: string[] = []
const report: Record<string, unknown> = {}

function check(name: string, condition: boolean, detail: unknown): void {
  if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`)
}

function textOf(result: DagToolResult): string {
  const first = result.content[0]
  return first?.type === "text" ? first.text : "(non-text)"
}

function definition(): DagDefinition {
  return {
    key: "wait-detach-qa",
    name: RUN_NAME,
    nodes: [
      { id: "alpha", prompt: "do alpha", category: "quick" },
      { id: "beta", prompt: "do beta", category: "quick" },
    ],
  }
}

function seedRunningRun(store: ReturnType<typeof createDagFileStore>): void {
  const createdAt = new Date().toISOString()
  const compiled = compileDag(definition(), { at: createdAt })
  if (!compiled.ok) throw new Error("QA dag did not compile")
  store.writeCheckpoint(RUN_ID, {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId: RUN_ID,
    runKey: definition().key,
    name: definition().name,
    parentSessionId: PARENT_SESSION,
    rootSessionId: ROOT_SESSION,
    definitionFingerprint: "qa-fingerprint",
    definition: {
      key: definition().key,
      name: definition().name,
      nodes: definition().nodes.map((entry) => ({ ...entry, effectivePrompt: entry.prompt })),
    },
    status: "running",
    generation: 1,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes.map((entry) => (entry.id === "alpha" ? { ...entry, state: "running", startedAt: createdAt } : entry)),
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  })
}

const root = fs.mkdtempSync(join(tmpdir(), "dag-wait-detach-qa-"))
try {
  const store = createDagFileStore({ project_dir: root })
  seedRunningRun(store)
  const manager = createDagManager({ store })
  // No live scheduler exists in this driver, so the live-subscription seam is a no-op and the
  // durable journal channel - the same one production falls back to - does the real work.
  const surface = createDagWaitSurface({ store, subscribe: () => () => undefined })
  const deps = { manager, parentSessionId: () => PARENT_SESSION, rootSessionId: () => ROOT_SESSION, wait: surface.wait }

  // Case A: the model-facing default detaches against a live run and registers NO waiter.
  const detached = await runDagTool(deps, { action: "wait", run_id: RUN_ID })
  report.detached_text = textOf(detached)
  check("default wait returns the detached kind", detached.details.kind === "detached", detached.details.kind)
  if (detached.details.kind === "detached") {
    check("detached carries the live snapshot", detached.details.snapshot.status === "running", detached.details.snapshot.status)
    check("detached names the wake contract", textOf(detached).includes("woken as each node completes"), textOf(detached))
  }
  check("default wait registers no waiter", surface.waiterCount(RUN_ID) === 0, surface.waiterCount(RUN_ID))

  // Case B: detach=false blocks for real, then a real checkpoint flip plus a real journal append
  // settles it through the durable subscription.
  let settledEarly = false
  const blocked = runDagTool(deps, { action: "wait", run_id: RUN_ID, detach: false }).then((result) => {
    settledEarly = true
    return result
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  check("detach=false blocks while the run is live", settledEarly === false, settledEarly)
  check("the blocking wait registered exactly one waiter", surface.waiterCount(RUN_ID) === 1, surface.waiterCount(RUN_ID))
  // Settle through the REAL journal append path: the scheduler's own reducer transitions the
  // checkpoint, the WAL is written, and publishCommit notifies the wait surface's durable channel.
  const seeded = store.readCheckpoint<DagRunRecordV1>(RUN_ID)
  if (seeded === null) throw new Error("expected the seeded checkpoint")
  const journal = createDagJournal<DagRunRecordV1>({
    store,
    runId: RUN_ID,
    initialCheckpoint: seeded,
    applyEvent: (record, event) => applyDagSchedulerEvent(record, event),
  })
  journal.append({
    type: "dag.run.completed",
    counts: { total: 2, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 2, failed: 0, cancelled: 0, skipped: 0 },
  })
  const waited = await Promise.race([
    blocked,
    new Promise<DagToolResult>((_resolve, reject) => setTimeout(() => reject(new Error("blocking wait did not settle within 2s")), 2000)),
  ])
  check("the durable journal settles the blocking wait", waited.details.kind === "waited", waited.details.kind)
  if (waited.details.kind === "waited") {
    check("the settled wait reports completed", waited.details.result.status === "completed", waited.details.result.status)
  }
  check("a settled run retains no waiter bookkeeping", surface.waiterCount(RUN_ID) === 0, surface.waiterCount(RUN_ID))

  // Case C: the default wait on a now-terminal run returns the final result immediately.
  const terminal = await runDagTool(deps, { action: "wait", run_id: RUN_ID })
  check("terminal run never detaches", terminal.details.kind === "waited", terminal.details.kind)

  // Case D: the real wake path - production coordinator flush window, real createDagWake.
  const deliveries: Array<{ readonly customType: unknown; readonly content: string; readonly deliverAs: string }> = []
  const coordinator = new IdleInjectionCoordinator(
    (message, options) => { deliveries.push({ customType: message.customType, content: message.content, deliverAs: options.deliverAs }) },
  )
  const wake = createDagWake({ coordinator, parentState: () => ({ kind: "idle" }) })
  wake.onRunEvent(
    { runId: RUN_ID, name: RUN_NAME, parentSessionId: PARENT_SESSION },
    {
      runId: RUN_ID,
      seq: 1,
      type: "dag.run.completed",
      counts: { total: 2, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 2, failed: 0, cancelled: 0, skipped: 0 },
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 700))
  report.wake_delivery = deliveries[0]
  check("the terminal wake is delivered through the real coordinator", deliveries.length === 1, deliveries.length)
  check("the wake rides a steer", deliveries[0]?.deliverAs === "steer", deliveries[0]?.deliverAs)
  check("the wake names the run and outcome", deliveries[0]?.content.includes(RUN_NAME) === true && deliveries[0]?.content.includes("completed") === true, deliveries[0]?.content)
  check("the wake carries the verification directive", deliveries[0]?.content.includes("TREAT AS FALSE UNTIL YOU PROVE IT") === true, deliveries[0]?.content)

  report.state_dir = store.stateDir
  report.failures = failures
  report.result = failures.length === 0 ? "PASS" : "FAIL"
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(join(outDir, "dag-wait-detach-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(JSON.stringify(report, null, 2))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

process.exit(failures.length === 0 ? 0 : 1)
