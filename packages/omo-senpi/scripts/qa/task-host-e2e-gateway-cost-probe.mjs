/**
 * The ready probe of the gateway cost driver (plan todo 23): one tiny extension, installed
 * IDENTICALLY into the sandbox agent dir (`<agentDir>/extensions/`) of every arm, so it is the marker
 * both arms share and never a change to the plugin under test.
 *
 * - `settled`: its `resources_discover` handler. senpi emits `resources_discover` only after it awaited
 *   EVERY extension's `session_start` handler (`AgentSession.bindExtensions`), so the mark is "the
 *   session_start work has returned" whatever order the extensions load in.
 * - `heap` (on SIGUSR2, which neither senpi without `SENPI_MEMORY_REPORT` nor omo handles): two full
 *   collections, then the engine's own retained-heap census (`bun:jsc` `heapStats()`: heap size, extra
 *   memory, object count and the count per object type; `node:v8` heap statistics under node), with
 *   `process.memoryUsage()` beside it. This is the direct measure of what a listener retains.
 * Every mark is one JSON line `{ event, at (epoch ms, sub-ms), pid, ... }` appended to
 * `$GATEWAY_COST_PROBE_OUT`; without that variable the probe does nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const PROBE_ENV = "GATEWAY_COST_PROBE_OUT"
export const PROBE_FILE = "gateway-cost-ready-probe.js"

const PROBE_SOURCE = `import { appendFileSync } from "node:fs"
const out = process.env.${PROBE_ENV}
const mark = (event, extra = {}) => { if (out) appendFileSync(out, JSON.stringify({ event, at: performance.timeOrigin + performance.now(), pid: process.pid, ...extra }) + "\\n") }
async function census() {
  const bun = globalThis.Bun
  if (bun !== undefined) {
    bun.gc(true)
    bun.gc(true)
    const { heapStats } = await import("bun:jsc")
    const s = heapStats()
    return { runtime: "bun", heap_size: s.heapSize, heap_capacity: s.heapCapacity, extra_memory: s.extraMemorySize, object_count: s.objectCount, protected_object_count: s.protectedObjectCount, object_types: s.objectTypeCounts, memory_usage: process.memoryUsage() }
  }
  const v8 = await import("node:v8")
  globalThis.gc?.()
  const s = v8.getHeapStatistics()
  return { runtime: "node", heap_size: s.used_heap_size, heap_capacity: s.total_heap_size, extra_memory: s.external_memory, object_count: null, object_types: null, memory_usage: process.memoryUsage() }
}
export default function gatewayCostReadyProbe(pi) {
  if (!out) return
  pi.on("session_start", () => mark("session_start"))
  pi.on("resources_discover", () => mark("settled"))
  process.on("SIGUSR2", () => { void census().then((heap) => mark("heap", heap), (error) => mark("heap_error", { error: String(error) })) })
}
`

/** Puts the probe into `agentDir/extensions/` (auto-discovered by senpi, the same in every arm). */
export function installProbe(agentDir) {
  const dir = join(agentDir, "extensions")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PROBE_FILE), PROBE_SOURCE)
}

/** The marks written so far (a line mid-append is read again later). */
export function probeMarks(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

/** The first `settled` mark after the first `session_start` mark. */
export function settledMark(marks) {
  const start = marks.find((mark) => mark.event === "session_start")
  return start === undefined ? undefined : marks.find((mark) => mark.event === "settled" && mark.at >= start.at)
}

/** Deterministic PRNG (mulberry32), so a report's bootstrap interval is reproducible from its samples. */
function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rank = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
const round1 = (value) => Math.round(value * 10) / 10

/**
 * Bootstrap 95% interval of `quantile(b) - quantile(a)` (nearest rank), resampling each arm
 * independently with replacement, 4000 rounds, fixed seed.
 */
export function bootstrapDelta(a, b, p, { rounds = 4000, seed = 23 } = {}) {
  const xs = a.filter(Number.isFinite)
  const ys = b.filter(Number.isFinite)
  if (xs.length < 2 || ys.length < 2) return null
  const random = rng(seed)
  const pick = (values) => {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)])
    return rank(sample.sort((x, y) => x - y), p)
  }
  const deltas = Array.from({ length: rounds }, () => pick(ys) - pick(xs)).sort((x, y) => x - y)
  const point = rank([...ys].sort((x, y) => x - y), p) - rank([...xs].sort((x, y) => x - y), p)
  return { quantile: p, point: round1(point), lo: round1(rank(deltas, 0.025)), hi: round1(rank(deltas, 0.975)), width: round1(rank(deltas, 0.975) - rank(deltas, 0.025)), rounds }
}

/** PASS when the whole interval is under the bound, FAIL when it is all over it, else UNRESOLVED. */
export function judgeInterval(interval, bound) {
  if (interval === null || interval === undefined) return "NOT_RUN"
  if (interval.hi < bound) return "PASS"
  if (interval.lo >= bound) return "FAIL"
  return "UNRESOLVED"
}
