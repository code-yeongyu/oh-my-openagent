#!/usr/bin/env bun
// Live QA for the DAG run-header honesty contract. Drives the REAL surfaces end to end: a real
// on-disk DagFileStore, the real recovery pause/claim writes that own leaseHolderPid, the real
// DagManager snapshot projection, and the real createDagStatusUi widget render. The lease holder
// is a genuinely spawned OS process, so the liveness probe answers about a real pid rather than a
// stub. Writes the captured widget rows to <out-dir> and exits non-zero on any contract violation.
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compileDag, type DagDefinition } from "@oh-my-opencode/senpi-task/dag"
import { createDagFileStore, createDagManager, createDagRecovery } from "@oh-my-opencode/senpi-task/dag"
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { createDagStatusUi, DAG_STATUS_UI_KEY } from "../../src/components/task/dag-status-ui"

const PARENT_SESSION = "session-parent"
const ROOT_SESSION = "session-root"
const RUN_ID = "run-paused-header" as DagRunId

const outDir = process.argv[2] ?? join(tmpdir(), "dag-paused-header-qa")
const failures: string[] = []
const report: Record<string, unknown> = {}

function check(name: string, condition: boolean, detail: unknown): void {
  if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`)
}

function definition(): DagDefinition {
  return {
    key: "paused-header-qa",
    name: "ship-it",
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

function widgetRows(store: ReturnType<typeof createDagFileStore>): readonly string[] {
  const manager = createDagManager({ store })
  let captured: readonly string[] = []
  const ui = createDagStatusUi({
    manager: {
      list: (sessionId) => manager.list(sessionId),
      snapshot: (runId, sessionId) => manager.snapshot(runId as DagRunId, sessionId),
    },
    runtime: {
      ui: () => ({
        setWidget: (key: string, rows: readonly string[] | undefined) => {
          if (key === DAG_STATUS_UI_KEY && rows !== undefined) captured = rows
        },
      }) as never,
      sessionId: () => PARENT_SESSION,
      mode: () => "tui",
    },
    timers: { set: () => 0, clear: () => undefined },
    terminalWidth: () => 200,
  })
  ui.syncNow()
  ui.dispose()
  return captured
}

const root = fs.mkdtempSync(join(tmpdir(), "dag-paused-header-qa-"))
// A real child process that stays alive for the duration of the probe: the lease-liveness check
// must answer about an actual OS pid, not a stubbed predicate.
const liveChild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })
await new Promise((resolve) => setTimeout(resolve, 200))
const livePid = liveChild.pid
if (livePid === undefined) throw new Error("QA could not spawn a live lease holder")

try {
  const store = createDagFileStore({ project_dir: root })

  // Case A: shutdown pause then a claim by a LIVE host -> header must read resuming.
  seedRunningRun(store)
  const pauseRecovery = createDagRecovery({ store, taskManager: {} as never, hostPid: livePid })
  pauseRecovery.pauseRunsForShutdown(PARENT_SESSION)
  const pausedRecord = store.readCheckpoint<Record<string, unknown>>(RUN_ID)
  check("shutdown pause clears the lease", pausedRecord?.leaseHolderPid === undefined, pausedRecord?.leaseHolderPid)
  check("shutdown pause parks the run", pausedRecord?.status === "paused", pausedRecord?.status)

  // The real claim write, performed by the live process itself.
  store.withRunLock(RUN_ID, () => {
    const fresh = store.readCheckpoint<Record<string, unknown>>(RUN_ID)
    store.writeCheckpoint(RUN_ID, { ...fresh, leaseHolderPid: livePid })
  })
  const resumingRows = widgetRows(store)
  report.resuming_header = resumingRows[0]
  report.resuming_rows = resumingRows
  check("live lease reads resuming", resumingRows[0]?.includes("resuming") === true, resumingRows[0])
  check("live lease drops the pause glyph", resumingRows[0]?.includes("⏸") === false, resumingRows[0])
  check("live lease uses the neutral run icon", resumingRows[0]?.startsWith("· ") === true, resumingRows[0])
  check("running lane keeps its own icon", resumingRows.slice(1).some((row) => row.includes("▶")), resumingRows.slice(1))

  // Case B: same paused run, lease holder now DEAD -> header must read suspended with the count.
  liveChild.kill("SIGKILL")
  await new Promise((resolve) => liveChild.once("exit", resolve))
  const deadRows = widgetRows(store)
  report.suspended_header = deadRows[0]
  check("dead lease over a running node reads suspended", deadRows[0]?.includes("suspended · 1 active") === true, deadRows[0])
  check("suspended header drops the pause glyph", deadRows[0]?.includes("⏸") === false, deadRows[0])

  // Case C: no running node left -> header falls back to plain paused under the neutral icon.
  store.withRunLock(RUN_ID, () => {
    const fresh = store.readCheckpoint<{ readonly nodes: readonly { readonly state: string }[] }>(RUN_ID)
    const parked = (fresh?.nodes ?? []).map((entry) => (entry.state === "running" ? { ...entry, state: "pending" } : entry))
    store.writeCheckpoint(RUN_ID, { ...fresh, nodes: parked })
  })
  const pausedRows = widgetRows(store)
  report.paused_header = pausedRows[0]
  check("no lease and no running node reads paused", pausedRows[0]?.includes("paused") === true, pausedRows[0])
  check("plain paused is not suspended", pausedRows[0]?.includes("suspended") === false, pausedRows[0])
  check("plain paused uses the neutral run icon", pausedRows[0]?.startsWith("· ") === true, pausedRows[0])
  check("plain paused drops the pause glyph", pausedRows[0]?.includes("⏸") === false, pausedRows[0])

  report.live_lease_pid = livePid
  report.state_dir = store.stateDir
  report.failures = failures
  report.result = failures.length === 0 ? "PASS" : "FAIL"

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(join(outDir, "dag-paused-header-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (liveChild.exitCode === null) liveChild.kill("SIGKILL")
  fs.rmSync(root, { recursive: true, force: true })
}

process.exit(failures.length === 0 ? 0 : 1)
