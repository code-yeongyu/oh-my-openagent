/**
 * The plan's todo 23 bounds, judged from a gateway cost report. The startup and memory rows are judged
 * on a bootstrap 95% interval of the arm delta (`-probe.mjs` `judgeInterval`): PASS when the whole
 * interval is under the bound, FAIL when it is all at or over it, UNRESOLVED when the noise band
 * straddles the bound. Startup is the p95 delta of the fully-ready time (spawn to the session_start
 * work settled, the endpoint accepting on the arm that has one); memory is the median delta of the
 * engine's retained heap after forced collections (heap size plus extra memory), the direct measure;
 * physical footprint and RSS are reported beside it. A row with fewer accepted samples than its
 * target says PARTIAL-, and a section that never ran is NOT_RUN. The loop scan is UNPROVEN when its
 * positive control did not find the line or no host `stderr.log` was scanned.
 */
import { bootstrapDelta, judgeInterval } from "./task-host-e2e-gateway-cost-probe.mjs"

export const BOUNDS = { startup_p95_delta_ms: 20, idle_memory_delta_mb: 3, thread_list_12_p95_ms: 1500, thread_send_p95_ms: 300 }

function judge(ok, complete) {
  if (ok === undefined) return "NOT_RUN"
  return `${complete ? "" : "PARTIAL-"}${ok ? "PASS" : "FAIL"}`
}

const finite = (value) => (Number.isFinite(value) ? value : undefined)
const partial = (verdict, complete) => (complete || verdict === "NOT_RUN" ? verdict : `PARTIAL-${verdict}`)
/** An arm that registered the wrong number of `tui` endpoints in any sample does not measure the listener: the A/B rows are INVALID. */
const armsHold = (ab) => ab === undefined || Object.values(ab.endpoint_check ?? {}).every((count) => count === 0)
const retained = (s) => (Number.isFinite(s.heap_mb) && Number.isFinite(s.heap_extra_mb) ? s.heap_mb + s.heap_extra_mb : undefined)

export function verdicts(report) {
  const ab = report.sections?.ab
  const gateway = report.sections?.gateway
  const rows = {}
  const ready = ab?.metrics?.fully_ready_ms
  rows.startup = {
    bound: `p95 fully-ready delta < ${BOUNDS.startup_p95_delta_ms} ms, judged on its bootstrap 95% interval (spawn to the session_start work settled; prompt, first echo and echo latency beside it)`,
    measured: ready === undefined ? null : { p95_delta_ms: ready.delta.p95, p95_delta_ci: ready.ci_p95, p50_delta_ms: ready.delta.p50, p50_delta_ci: ready.ci_p50, min_of_n_delta_ms: ready.delta.min, a: ready.a, b: ready.b, prompt_delta: ab.metrics.prompt_ms?.delta ?? null, echo_max_delta: ab.metrics.echo_max_ms?.delta ?? null },
    n: ab?.accepted_pairs ?? 0,
    verdict: armsHold(ab) ? partial(judgeInterval(ready?.ci_p95, BOUNDS.startup_p95_delta_ms), ab?.partial === false) : "INVALID",
  }
  const heapA = (ab?.samples?.a ?? []).map(retained)
  const heapB = (ab?.samples?.b ?? []).map(retained)
  const heapCi = ab === undefined ? null : bootstrapDelta(heapA, heapB, 0.5)
  rows.idle_memory = {
    bound: `idle memory delta < ${BOUNDS.idle_memory_delta_mb} MB, judged on the bootstrap 95% interval of the median delta of the engine's retained heap after forced collections (heap + extra memory); physical footprint and RSS beside it`,
    measured: ab === undefined ? null : { retained_heap_p50_delta_mb: heapCi?.point ?? null, retained_heap_ci: heapCi, heap_objects_p50_delta: ab.metrics.heap_objects?.delta?.p50 ?? null, engine_footprint: ab.metrics.engine_footprint_mb ?? null, tree_footprint: ab.metrics.footprint_mb ?? null, tree_rss: ab.metrics.rss_mb ?? null, engine_threads: ab.metrics.engine_threads ?? null },
    n: ab?.accepted_pairs ?? 0,
    verdict: armsHold(ab) ? partial(judgeInterval(heapCi, BOUNDS.idle_memory_delta_mb), ab?.partial === false) : "INVALID",
  }
  const n12 = gateway?.thread_list?.n12
  const listP95 = n12?.cold?.n > 0 || n12?.warm?.n > 0 ? Math.max(n12.cold?.p95 ?? 0, n12.warm?.p95 ?? 0) : undefined
  const listClean = n12 !== undefined && (n12.cold?.timeouts ?? 0) + (n12.warm?.timeouts ?? 0) === 0 && [...(n12.cold?.tui_rows_listed ?? []), ...(n12.warm?.tui_rows_listed ?? [])].every((rows) => rows === 12)
  rows.thread_list_12 = {
    bound: `thread_list with 12 endpoints < ${BOUNDS.thread_list_12_p95_ms} ms p95 (cold and warm series, tool boundary)`,
    measured: n12 === undefined ? null : { cold_p95_ms: n12.cold?.p95 ?? null, cold_min_ms: n12.cold?.min ?? null, warm_p95_ms: n12.warm?.p95 ?? null, warm_min_ms: n12.warm?.min ?? null, cold_roundtrip_p95_ms: n12.cold?.roundtrip_ms?.p95 ?? null, every_call_listed_12: listClean },
    n: (n12?.cold?.n ?? 0) + (n12?.warm?.n ?? 0),
    verdict: judge(listP95 === undefined ? undefined : listP95 < BOUNDS.thread_list_12_p95_ms && listClean, n12?.partial === false),
  }
  const send = gateway?.thread_send
  const sendP95 = finite(send?.tool?.p95)
  rows.thread_send = {
    bound: `thread_send to an idle endpoint < ${BOUNDS.thread_send_p95_ms} ms p95 (tool entry to tool return)`,
    measured: send === undefined ? null : { p95_ms: sendP95 ?? null, min_ms: send.tool?.min ?? null, cold_p95_ms: send.tool_cold?.p95 ?? null, warm_p95_ms: send.tool_warm?.p95 ?? null, acceptance_p95_ms: send.acceptance?.p95 ?? null, provider_roundtrip_p95_ms: send.provider_roundtrip?.p95 ?? null, not_ok: send.not_ok },
    n: send?.tool?.n ?? 0,
    verdict: judge(sendP95 === undefined ? undefined : sendP95 < BOUNDS.thread_send_p95_ms && send.not_ok === 0, send?.partial === false),
  }
  const loop = report.event_loop_blocked
  const proven = loop?.control?.found === true && (loop?.host_stderr_files ?? 0) > 0
  rows.event_loop_blocked = {
    bound: "zero `event loop blocked` lines (every pty stream, every sandbox agent dir, every host stderr.log)",
    measured: { lines: loop?.hits?.length ?? null, files_scanned: loop?.files_scanned ?? null, streams_scanned: loop?.streams_scanned ?? null, host_stderr_files: loop?.host_stderr_files ?? null, control_found: loop?.control?.found ?? null },
    verdict: (loop?.hits?.length ?? 0) > 0 ? "FAIL" : proven ? "PASS" : "UNPROVEN",
  }
  return rows
}
