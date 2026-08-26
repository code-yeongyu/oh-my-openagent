// Real-surface print: drive the ACTUAL createDagWake + the ACTUAL IdleInjectionCoordinator and show
// the exact model-facing wake message senpi would receive for a terminal DAG run vs a paused run.
// Read-only w.r.t. the repo: no production/test file is modified by this script.
import { createDagWake } from "/private/tmp/ulw-wt-dag-directive/packages/omo-senpi/src/components/task/dag-wake"
import { IdleInjectionCoordinator } from "/private/tmp/ulw-wt-dag-directive/packages/omo-senpi/src/extension/idle-injection-coordinator"
import { DAG_VERIFICATION_DIRECTIVE } from "/private/tmp/ulw-wt-dag-directive/packages/senpi-task/src/index"

const delivered: { message: any; options: any }[] = []
const coordinator = new IdleInjectionCoordinator((message, options) => {
  delivered.push({ message, options })
  return undefined
})

const wake = createDagWake({ coordinator, parentState: () => ({ kind: "idle" }) as any })
const run = { runId: "dag_run_live", name: "verification-demo", parentSessionId: "ses-live" }
const counts = { total: 3, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 3, failed: 0, cancelled: 0, skipped: 0 }

// 1. terminal completed run -> must carry the directive
wake.onRunEvent(run, { runId: run.runId, seq: 1, type: "dag.run.completed", counts })
await new Promise((r) => setTimeout(r, 50))

console.log("=== TERMINAL dag.run.completed: model-facing injected message ===")
console.log(JSON.stringify(delivered[0]?.message, null, 2))
console.log("=== deliverAs ===", JSON.stringify(delivered[0]?.options))
console.log("=== terminal content carries directive? ===", String(delivered[0]?.message?.content ?? "").includes(DAG_VERIFICATION_DIRECTIVE))

// 2. failed terminal run -> also carries the directive, with the failure line intact
delivered.length = 0
const failCounts = { ...counts, completed: 1, failed: 2 }
wake.onRunEvent(
  { ...run, runId: "dag_run_failed" },
  { runId: "dag_run_failed", seq: 2, type: "dag.run.failed", counts: failCounts, error: { code: "node_failed", message: "impl node never produced plan.md", nodeId: "impl" } },
)
await new Promise((r) => setTimeout(r, 50))
console.log()
console.log("=== TERMINAL dag.run.failed: model-facing content ===")
console.log(delivered[0]?.message?.content)
console.log("=== failed content carries directive? ===", String(delivered[0]?.message?.content ?? "").includes(DAG_VERIFICATION_DIRECTIVE))

// 3. paused (NOT a completion claim) -> must stay directive-free
delivered.length = 0
wake.onRunEvent({ ...run, runId: "dag_run_paused" }, { runId: "dag_run_paused", seq: 3, type: "dag.run.paused", reason: "session shutdown" })
await new Promise((r) => setTimeout(r, 50))
console.log()
console.log("=== PAUSED dag.run.paused: model-facing content ===")
console.log(delivered[0]?.message?.content)
console.log("=== paused content carries directive? ===", String(delivered[0]?.message?.content ?? "").includes(DAG_VERIFICATION_DIRECTIVE))

// 4. exactly-once: the directive must appear once per terminal injection, not doubled
const terminalOnce = String(delivered[0]?.message?.content ?? "")
console.log()
console.log("=== directive occurrences in the paused injection ===", terminalOnce.split("TREAT AS FALSE UNTIL YOU PROVE IT").length - 1)
