/**
 * (c) `thread_list` latency with N = 1, 5, 12 pty TUIs on one isolated agent dir (plan todo 23).
 *
 * Tool latency is `tool_enter` -> `tool_return` of the caller's `thread_list` execute wrapper (the
 * trace in `task-host-e2e-gateway-cost-trace.mjs`; TUI 0 is the only process that calls the tool); the fake model's call -> result interval is kept
 * beside it as an upper bound. `thread_list` enumerates endpoints through a 5 s per-process cache
 * (`live-surface.ts` HOST_ENDPOINTS_CACHE_TTL_MS): the cold series waits that window out before each
 * call (what a user's single call pays), the warm series runs back to back. Each series runs in load
 * batches of `batchSize` samples. `omo thread list --json` wall time (CLI process start included) is
 * recorded per N.
 */
import { createBatches, load1, stats } from "./task-host-e2e-gateway-cost-batch.mjs"
import { scanText } from "./task-host-e2e-gateway-cost-scan.mjs"
import { traceRecords } from "./task-host-e2e-gateway-cost-trace.mjs"

const gw = await import("./thread-tools/lib/gateway.mjs")
const { waitFor, assistantTexts, omo } = gw

const CACHE_WINDOW_MS = 5_000 + 500
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

/** One `thread_list` call from TUI 0: tool time from the trace, round trip from the fake model, rows listed. */
async function listOnce(ctx, g, n, label) {
  const from = g.fake.requests.length
  const mark = traceRecords(g.trace).length
  const load = load1()
  try {
    await g.callerIdle(`caller idle before thread_list N=${n} ${label}`)
    await g.tuis[0].submit(g.listScript)
    const measured = await waitFor(() => {
      const requests = g.fake.requests.slice(from)
      const call = requests.findIndex((request) => request.answer?.kind === "tool_calls" && request.answer.calls.some((entry) => entry.name === "thread_list"))
      if (call === -1) return undefined
      const result = requests.slice(call + 1).find((request) => request.answer?.kind === "tool_result" && request.answer.tool === "thread_list")
      return result === undefined ? undefined : { roundtrip_ms: result.at - requests[call].at, result: result.answer.result }
    }, { label: `thread_list N=${n} ${label}`, timeoutMs: 60_000 })
    const records = traceRecords(g.trace).slice(mark).filter((row) => row.tool === "thread_list")
    const enter = records.find((row) => row.event === "tool_enter")
    const ret = records.find((row) => row.event === "tool_return" && row.at >= (enter?.at ?? Infinity))
    g.listed += 1
    await waitFor(() => assistantTexts(g.endpoints[0].sessionPath).filter((text) => text.includes("QA-TOOL-RESULT thread_list")).length >= g.listed, { label: `caller turn after thread_list #${g.listed}`, timeoutMs: 60_000 })
    return { ms: enter === undefined || ret === undefined ? null : Math.round((ret.at - enter.at) * 10) / 10, roundtrip_ms: measured.roundtrip_ms, rows: (measured.result.match(/"surface"\s*:\s*"tui"/g) ?? []).length, load1: load }
  } catch (error) {
    g.stalls.push(await g.stallDiagnostics(from, `thread_list N=${n} ${label}`, error))
    g.listed = assistantTexts(g.endpoints[0].sessionPath).filter((text) => text.includes("QA-TOOL-RESULT thread_list")).length
    return { ms: null, timeout: true, rows: null, load1: load }
  }
}

function seriesSummary(batches) {
  const samples = batches.samples()
  return {
    ...stats(samples.map((s) => s.ms)),
    roundtrip_ms: stats(samples.map((s) => s.roundtrip_ms)),
    timeouts: samples.filter((s) => s.timeout).length,
    tui_rows_listed: [...new Set(samples.filter((s) => !s.timeout).map((s) => s.rows))],
    batches: batches.summary(),
    samples,
  }
}

/** Fills `out.thread_list` and `out.cli_thread_list` per N as each finishes. */
export async function listSeries(ctx, g, out) {
  out.thread_list = {}
  out.cli_thread_list = {}
  for (const n of ctx.opts.listNs) {
    if (ctx.deadline.reached(`thread_list N=${n} setup`)) return
    await g.addTuis(n)
    const cell = { endpoints: n, target_samples: ctx.opts.listSamples }
    out.thread_list[`n${n}`] = cell
    if (g.listed === 0) cell.first_call_of_session = await listOnce(ctx, g, n, "first call")
    // Until the cache window has passed, newly registered terminals are not listed yet.
    cell.settle = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await pause(CACHE_WINDOW_MS)
      cell.settle.push(await listOnce(ctx, g, n, `settle #${attempt}`))
      if (cell.settle.at(-1).rows === n) break
    }
    for (const [series, wait] of [["cold", CACHE_WINDOW_MS], ["warm", 0]]) {
      const batches = createBatches(`thread_list N=${n} ${series}`, { log: ctx.log, deadline: ctx.deadline })
      for (let start = 0; start < ctx.opts.listSamples; start += ctx.opts.batchSize) {
        const size = Math.min(ctx.opts.batchSize, ctx.opts.listSamples - start)
        const batch = await batches.run(`#${start}-${start + size - 1}`, async () => {
          const samples = []
          for (let index = 0; index < size; index += 1) {
            if (wait > 0) await pause(wait)
            samples.push(await listOnce(ctx, g, n, `${series} #${start + index}`))
          }
          return samples
        })
        if (batch === undefined && ctx.deadline.reached()) break
      }
      cell[series] = seriesSummary(batches)
      cell.partial = (cell.partial ?? false) || cell[series].n < ctx.opts.listSamples
      ctx.log(`thread_list N=${n} ${series}: tool ${JSON.stringify(stats(batches.samples().map((s) => s.ms)))} roundtrip p95 ${cell[series].roundtrip_ms.p95} rows ${cell[series].tui_rows_listed} discarded ${cell[series].batches.discarded.length}`)
    }
    const cli = []
    const cliRows = []
    for (let index = 0; index < ctx.opts.cliSamples && !ctx.deadline.reached(`omo thread list N=${n}`); index += 1) {
      const t0 = performance.now()
      const answered = await omo(g.scratch, g.install, ["thread", "list", "--json"], { env: { THREAD_QA_TRACE: g.trace } })
      cli.push(performance.now() - t0)
      const rows = Array.isArray(answered.json) ? answered.json : answered.json?.threads
      cliRows.push(Array.isArray(rows) ? rows.filter((row) => row.surface === "tui").length : `exit ${answered.code}`)
      scanText(ctx.scan, answered.stderr, `omo thread list N=${n} stderr`)
    }
    out.cli_thread_list[`n${n}`] = { ...stats(cli), tui_rows_listed: [...new Set(cliRows)] }
    ctx.log(`omo thread list --json N=${n}: ${JSON.stringify(stats(cli))}`)
  }
}
