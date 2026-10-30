import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  budgetAllows, digestJson, epochDelta, finalizeReport, percentile, recommendDefault, scoreYield,
  type MeasurementRun, type TokenSnapshot,
} from "../../packages/senpi-task/src/workpool/measurement.ts"
import { openMeasureEnv } from "./omp-item2-measure-env.ts"

const E = process.env.E ?? "/Users/yeongyu/sisyphuslabs/.omo/evidence/omp-adoption-eval-dag-read-20260912"
const PLAN = "31121b6554593f7f2a24d552ffe39825943b94bcfef78efbe63bcf556ba33f55"
const MODES = ["fresh", "keep_alive", "keep_alive", "fresh"] as const
const batch = JSON.parse(readFileSync(new URL("../../packages/senpi-task/test/fixtures/workpool-real-batch.json", import.meta.url), "utf8")) as {
  readonly batch_sha256: string; readonly source_sha256: string; readonly prompt_sha256: string; readonly item_order_sha256: string
  readonly prompt: string; readonly items: readonly { readonly key: string; readonly input: unknown; readonly expected: unknown; readonly repo: string }[]
}

export async function runMeasure(out: string) {
  const oq3 = JSON.parse(readFileSync(join(E, "gates/OQ3.json"), "utf8")) as { readonly decision: { readonly provider: string; readonly model: string; readonly max_cost_usd: number; readonly max_total_tokens: number; readonly allowed_fallback_chain: unknown[] } }
  const ceiling = { max_cost_usd: oq3.decision.max_cost_usd, max_total_tokens: oq3.decision.max_total_tokens }
  const caps = digestJson({ width: 2, global_concurrency: 2, default_concurrency: 2, residency_max_children: 2 })
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const privateEvents: unknown[] = []
  const rows: string[] = ["run,mode,key,accepted_ms,grant_ms,start_ms,first_result_ms,terminal_ms,wall_ms,correct,tokens,cost,task_id,run_epoch"]
  const env = await openMeasureEnv()
  console.error(`[measure] env root=${env.root} model=${env.modelId}`)
  writeFileSync(join(dirname(out), "measure-root.txt"), `${env.root}\n`)
  let spent = { cost: 0, tokens: 0 }
  let exhausted = false
  let coverage = true
  let duplicates = 0
  let uncertain = 0
  const runs: MeasurementRun[] = []
  try {
    for (const [index, mode] of MODES.entries()) {
      console.error(`[measure] run ${index} ${mode} spent=${spent.cost.toFixed(4)}/${ceiling.max_cost_usd} tokens=${spent.tokens}`)
      const run = await oneRun(env, mode, index, spent, ceiling, caps, privateEvents, rows)
      console.error(`[measure] run ${index} ${mode} complete=${run.record.complete} scored=${run.record.scored_items} correct=${run.record.correct_items} tokens=${run.record.total_tokens} cost=${run.record.cost_usd} p95=${run.record.p95_ms} peak=${run.record.peak_residents} exhausted=${run.exhausted} coverage=${run.token_coverage}`)
      spent = { cost: spent.cost + run.record.cost_usd, tokens: spent.tokens + run.record.total_tokens }
      coverage = coverage && run.token_coverage
      duplicates += run.duplicates
      uncertain += run.uncertain
      exhausted = exhausted || run.exhausted
      runs.push(run.record)
      if (run.exhausted) {
        for (const rest of MODES.slice(index + 1)) runs.push(incomplete(rest, caps))
        break
      }
    }
  } finally {
    env.manager.workpools.dispose()
    env.lifecycle.dispose?.()
    for (const taskId of env.manager.residentTaskIds()) await env.lifecycle.destroyResidentTask(taskId, "cancel")
  }
  while (runs.length < 4) runs.push(incomplete(MODES[runs.length]!, caps))
  const report = finalizeReport({
    schema_version: 1, plan_sha256: PLAN, design: "AB/BA", width: 2, batch_sha256: batch.batch_sha256,
    source_sha256: batch.source_sha256, item_count: 12, senpi_items: 6, omo_items: 6, token_coverage: coverage && !exhausted,
    budget_exhausted: exhausted, duplicate_dispatches: duplicates, uncertain_dispatches: uncertain, runs,
  })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report)}\n`)
  writeFileSync(join(dirname(out), "per-item.csv"), `${rows.join("\n")}\n`)
  writeFileSync(join(dirname(out), "recommendation.json"), JSON.stringify({ recommendation: recommendDefault(report), commit, provider: oq3.decision.provider, model: oq3.decision.model, spent }, null, 2))
  writeFileSync(join(dirname(out), "private-events.json"), JSON.stringify({ commit, spent, events: privateEvents }))
  return { passed: report.status === "conclusive", out, recommendation: recommendDefault(report), report, written: true }
}

function incomplete(mode: typeof MODES[number], caps: string): MeasurementRun {
  return {
    mode, provider: "xai", model: "grok-4.6", batch_sha256: batch.batch_sha256, prompt_sha256: batch.prompt_sha256,
    caps_sha256: caps, item_order_sha256: batch.item_order_sha256, scored_items: 0, correct_items: 0,
    total_tokens: 0, cost_usd: 0, p95_ms: 0, peak_residents: 0, complete: false,
  }
}

async function oneRun(env: Awaited<ReturnType<typeof openMeasureEnv>>, mode: typeof MODES[number], index: number, spent: { cost: number; tokens: number }, ceiling: { max_cost_usd: number; max_total_tokens: number }, caps: string, privateEvents: unknown[], rows: string[]) {
  if (!budgetAllows(spent, ceiling)) return { record: incomplete(mode, caps), exhausted: true, token_coverage: false, duplicates: 0, uncertain: 0 }
  const acceptedAt = Date.now()
  const times = new Map<string, { grant?: number; start?: number; result?: number; terminal?: number; task_id?: string; run_epoch?: number }>()
  const seenDispatch = new Set<string>()
  let duplicates = 0
  let uncertain = 0
  let peak = 0
  let runCost = 0
  let runTokens = 0
  let covered = true
  let exhausted = false
  const last = new Map<string, { epoch: number; stats?: TokenSnapshot }>()
  const unsub = env.manager.workpools.subscribe(event => {
    privateEvents.push({ at: new Date().toISOString(), run: index, mode, ...event })
    const pool = env.manager.workpools.inspect(env.caller, event.pool_id)
    peak = Math.max(peak, pool.workers.filter(worker => worker.status === "busy").length)
    if (event.kind === "granted" && event.item_id) stamp(times, pool, event.item_id, "grant")
    if (event.kind === "dispatched" && event.item_id) {
      const key = `${event.item_id}:${event.task_id}:${event.run_epoch}`
      if (seenDispatch.has(key)) duplicates += 1
      seenDispatch.add(key)
      stamp(times, pool, event.item_id, "start", event)
    }
    if (event.kind === "item_result" && event.item_id) stamp(times, pool, event.item_id, "result", event)
    if (event.error?.code === "delivery_uncertain") uncertain += 1
    if (event.kind === "worker_idle" && event.task_id !== undefined && event.run_epoch !== undefined) {
      const record = env.store.load(event.task_id)
      const stats = record?.run_stats as TokenSnapshot | undefined
      const prior = last.get(event.task_id)
      const delta = epochDelta(prior?.epoch === event.run_epoch ? prior.stats : undefined, stats)
      covered = covered && delta.covered
      if (delta.covered) { runTokens += delta.tokens; runCost += delta.cost }
      last.set(event.task_id, { epoch: event.run_epoch, stats })
      if (!budgetAllows({ cost: spent.cost + runCost, tokens: spent.tokens + runTokens }, ceiling)) {
        exhausted = true
        env.manager.workpools.cancel(env.caller, event.pool_id)
      }
    }
  })
  const pool = env.manager.workpools.create(env.caller, { name: `measure-${index}-${mode}`, mode, agent: { category: "quick", prompt: batch.prompt, model: "xai/grok-4.6" } })
  const keys = batch.items.map(item => item.key)
  const done = waitKeys(env, pool.pool_id, keys, AbortSignal.timeout(1_200_000))
  env.manager.workpools.push(env.caller, pool.pool_id, batch.items.map(item => ({ key: item.key, input: item.input as never })))
  const finished = await done
  unsub()
  const expected = new Map(batch.items.map(item => [item.key, item.expected]))
  let correct = 0
  for (const item of finished.items) {
    const stampRow = times.get(item.key) ?? {}
    if (item.status === "completed" && scoreYield(item.data, expected.get(item.key))) correct += 1
    if (item.status === "completed" || item.status === "error" || item.status === "cancelled") stampRow.terminal ??= Date.now()
    const wall = stampRow.terminal === undefined ? 0 : stampRow.terminal - acceptedAt
    rows.push([index, mode, item.key, acceptedAt, stampRow.grant ?? "", stampRow.start ?? "", stampRow.result ?? "", stampRow.terminal ?? "", wall, Number(item.status === "completed" && scoreYield(item.data, expected.get(item.key))), "", "", stampRow.task_id ?? "", stampRow.run_epoch ?? ""].join(","))
  }
  for (const worker of finished.workers) await env.manager.cancelTask(worker.task_id).catch(() => undefined)
  env.manager.workpools.cancel(env.caller, pool.pool_id)
  for (const taskId of env.manager.residentTaskIds()) await env.lifecycle.destroyResidentTask(taskId, "cancel")
  const walls = finished.items.map(item => { const t = times.get(item.key); return t?.terminal === undefined ? 0 : t.terminal - acceptedAt })
  console.error(`[measure] run ${index} items ${finished.items.map(item => `${item.key}:${item.status}:${item.error?.code ?? "ok"}`).join(",")}`)
  const complete = finished.items.length === 12 && finished.items.every(item => item.status === "completed" || item.status === "error") && !exhausted
  return {
    exhausted, token_coverage: covered && runTokens > 0, duplicates, uncertain,
    record: {
      mode, provider: "xai", model: "grok-4.6", batch_sha256: batch.batch_sha256, prompt_sha256: batch.prompt_sha256,
      caps_sha256: caps, item_order_sha256: batch.item_order_sha256, scored_items: finished.items.length, correct_items: correct,
      total_tokens: runTokens, cost_usd: runCost, p95_ms: percentile(walls, 95), peak_residents: peak, complete,
    },
  }
}

function stamp(times: Map<string, { grant?: number; start?: number; result?: number; terminal?: number; task_id?: string; run_epoch?: number }>, pool: { items: readonly { item_id: string; key: string }[] }, itemId: string, field: "grant" | "start" | "result", event?: { task_id?: string; run_epoch?: number }) {
  const item = pool.items.find(candidate => candidate.item_id === itemId)
  if (item === undefined) return
  const row = times.get(item.key) ?? {}
  row[field] ??= Date.now()
  if (event?.task_id) row.task_id = event.task_id
  if (event?.run_epoch !== undefined) row.run_epoch = event.run_epoch
  times.set(item.key, row)
}

function waitKeys(env: Awaited<ReturnType<typeof openMeasureEnv>>, poolId: `wp_${string}`, keys: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<ReturnType<typeof env.manager.workpools.inspect>>((resolve, reject) => {
    const stop = (): void => { unsub(); signal.removeEventListener("abort", abort) }
    const abort = (): void => { stop(); reject(signal.reason) }
    const check = (): void => {
      const pool = env.manager.workpools.inspect(env.caller, poolId)
      if (keys.every(key => pool.items.some(item => item.key === key && (item.status === "completed" || item.status === "error" || item.status === "cancelled")))) {
        stop(); resolve(pool)
      }
    }
    const unsub = env.manager.workpools.subscribe(event => { if (event.pool_id === poolId) check() })
    signal.addEventListener("abort", abort, { once: true })
    check()
  })
}
