// The verdict half of task-host-e2e-shard-cost.mjs (rpc-host-sharding todo 15), kept free of any
// process or filesystem access so the three ways a run must FAIL - a target the measurement misses,
// a section that was never measured, a latency scenario with too few samples - are provable by a
// unit test and by re-evaluating a recorded run, not only by waiting for a live one to go wrong.
//
// Exit contract (the plan's): 0 = every section measured and every target row PASS; 2 = every
// section measured but at least one target row FAIL (a plan finding, never a reason to loosen the
// value); 1 = a section is missing, a cell is null, or a latency scenario is below the required
// sample count.

export const SECTIONS = ["idle", "marginal", "totals", "idle_exit", "latency", "prewarm_idle"]
export const REQUIRED_SAMPLES = 20
export const LATENCY_SCENARIOS = [
  "cold_first_child",
  "warm_first_turn",
  "warm_session_start",
  "reattach_after_crash",
  "ensure_n1",
  "ensure_n4",
  "user_first_child_off",
  "user_first_child_first_turn",
  "user_first_child_session_start",
  "user_first_child_default",
  "user_first_child_control",
]

/**
 * The Budgets section's acceptance values for THIS measurement. Nothing in the product reads them.
 * `max` rows pass when measured <= target; `equals` rows pass when measured === target.
 */
export const DEFAULT_TARGETS = {
  // Idle memory is judged on physical footprint only: RSS double-counts the clean file-backed pages the
  // supervisor and the host both map (plan Budgets amendment 2026-09-28). RSS is still recorded in the idle section.
  idle_footprint_mb: { max: 170, unit: "MB", what: "idle shard endpoint physical footprint (supervisor + host tree)" },
  cold_p95_ms: { max: 12_000, unit: "ms", what: "cold first child: task call -> first child model request, p95" },
  warm_first_turn_p95_ms: { max: 4_000, unit: "ms", what: "pre-warmed (first-turn) first child, p95" },
  warm_session_start_p95_ms: { max: 4_000, unit: "ms", what: "pre-warmed (session-start) first child, p95" },
  reattach_p95_ms: { max: 30_000, unit: "ms", what: "host SIGSEGV -> first continuation model request, p95" },
  user_first_child_p50_vs_control: { equals: true, what: "user-shaped first child with the DEFAULT pre-warm: p50 <= the control's first child on its already-running shared host" },
  user_first_child_p95_vs_control: { equals: true, what: "user-shaped first child with the DEFAULT pre-warm: p95 <= the control's first child on its already-running shared host" },
  prewarm_idle_host_exits: { equals: true, what: "the pre-warmed host of a session that never spawns a child (default AND session-start) exits on its idle window while the parent lives" },
  d1_both_idled_out: { equals: true, what: "all parents quit: every endpoint of BOTH configurations gone at +16 min" },
  d2_default_departed_shards_gone: { equals: true, what: "defaults: A's and B's shards gone at +16 min, C's alive" },
  d2_default_control_retained_evicted: { equals: true, what: "defaults: control host alive with sessions.retained == 0 at +16 min" },
  d2_default_sharded_rss_lower: { equals: true, what: "defaults: RSS of everything alive at +16 min, sharded < control" },
  d2_long_departed_shards_gone: { equals: true, what: "NON-DEFAULT eviction 1 h: A's and B's shards gone at +16 min, C's alive" },
  d2_long_control_retains: { equals: true, what: "NON-DEFAULT eviction 1 h: control host still holds >= 2 retained sessions at +16 min" },
  d2_long_sharded_rss_lower: { equals: true, what: "NON-DEFAULT eviction 1 h: RSS of everything alive at +16 min, sharded < control" },
}

/** Which target rows each section feeds; a skipped section contributes none and fails completeness. */
const SECTION_ROWS = {
  idle: ["idle_footprint_mb"],
  marginal: [],
  totals: [],
  idle_exit: [
    "d1_both_idled_out",
    "d2_default_departed_shards_gone",
    "d2_default_control_retained_evicted",
    "d2_default_sharded_rss_lower",
    "d2_long_departed_shards_gone",
    "d2_long_control_retains",
    "d2_long_sharded_rss_lower",
  ],
  latency: ["cold_p95_ms", "warm_first_turn_p95_ms", "warm_session_start_p95_ms", "reattach_p95_ms", "user_first_child_p50_vs_control", "user_first_child_p95_vs_control"],
  prewarm_idle: ["prewarm_idle_host_exits"],
}

/** The `--control` failure scenario measures only the control half of (d); these rows are its contract. */
export const CONTROL_ONLY_ROWS = {
  control_d1_idled_out: { equals: true, what: "control: all parents quit -> the single host idled out at +16 min" },
  control_d2_default_retained_evicted: { equals: true, what: "control, defaults: host alive, sessions.retained == 0 at +16 min" },
  control_d2_long_retains: { equals: true, what: "control, eviction 1 h: host alive, sessions.retained >= 2 at +16 min" },
}

/** Nearest-rank percentile: the smallest sample with at least p% of the samples at or below it. */
export function nearestRank(samples, percentile) {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((left, right) => left - right)
  const rank = Math.ceil((percentile / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

/** One latency scenario's cell: every observation kept, p50/p95 nearest-rank, min supplementary. */
export function summarizeSamples(samples, extra = {}) {
  const clean = samples.filter((value) => typeof value === "number" && Number.isFinite(value)).map((value) => Math.round(value))
  return {
    samples_ms: clean,
    n: clean.length,
    p50_ms: nearestRank(clean, 50),
    p95_ms: nearestRank(clean, 95),
    min_ms: clean.length === 0 ? null : Math.min(...clean),
    max_ms: clean.length === 0 ? null : Math.max(...clean),
    ...extra,
  }
}

/** `--target idle_footprint_mb=1` -> a max-row override; `--target d1_both_idled_out=false` -> an equals row. */
export function applyTargetOverrides(targets, overrides) {
  const next = structuredClone(targets)
  for (const raw of overrides) {
    const [key, value] = raw.split("=")
    if (next[key] === undefined || value === undefined) throw new Error(`unknown --target ${raw}`)
    if ("max" in next[key]) next[key].max = Number(value)
    else next[key].equals = value === "true"
  }
  return next
}

/** Every path whose value is null/undefined/NaN - "no null cells" is part of completeness. */
export function nullCells(value, path = "") {
  if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) return [path || "<root>"]
  if (Array.isArray(value)) return value.flatMap((entry, index) => nullCells(entry, `${path}[${index}]`))
  if (typeof value === "object") return Object.entries(value).flatMap(([key, entry]) => nullCells(entry, path ? `${path}.${key}` : key))
  return []
}

function row(id, target, measured) {
  const verdict =
    measured === null || measured === undefined
      ? "FAIL"
      : "max" in target
        ? typeof measured === "number" && measured <= target.max
          ? "PASS"
          : "FAIL"
        : measured === target.equals
          ? "PASS"
          : "FAIL"
  return { id, what: target.what, measured, target: "max" in target ? `<= ${target.max} ${target.unit}` : target.equals, verdict }
}

/** The measured value each default row reads out of the report's sections. */
function measuredFor(id, sections) {
  const latency = sections.latency?.scenarios ?? {}
  const exit = sections.idle_exit ?? {}
  switch (id) {
    case "idle_footprint_mb": return sections.idle?.sharded?.endpoint_footprint_mb
    case "cold_p95_ms": return latency.cold_first_child?.p95_ms
    case "warm_first_turn_p95_ms": return latency.warm_first_turn?.p95_ms
    case "warm_session_start_p95_ms": return latency.warm_session_start?.p95_ms
    case "reattach_p95_ms": return latency.reattach_after_crash?.p95_ms
    case "user_first_child_p50_vs_control": return notSlower(latency.user_first_child_default?.p50_ms, latency.user_first_child_control?.p50_ms)
    case "user_first_child_p95_vs_control": return notSlower(latency.user_first_child_default?.p95_ms, latency.user_first_child_control?.p95_ms)
    case "prewarm_idle_host_exits": return prewarmIdleExits(sections.prewarm_idle)
    case "d1_both_idled_out": return exit.d1?.sharded?.all_gone === true && exit.d1?.control?.all_gone === true
    case "d2_default_departed_shards_gone": return exit.d2_default?.sharded?.departed_gone === true && exit.d2_default?.sharded?.survivor_alive === true
    case "d2_default_control_retained_evicted": return exit.d2_default?.control?.host_alive === true && exit.d2_default?.control?.retained === 0
    case "d2_default_sharded_rss_lower": return lower(exit.d2_default)
    case "d2_long_departed_shards_gone": return exit.d2_long?.sharded?.departed_gone === true && exit.d2_long?.sharded?.survivor_alive === true
    case "d2_long_control_retains": return exit.d2_long?.control?.host_alive === true && (exit.d2_long?.control?.retained ?? -1) >= 2
    case "d2_long_sharded_rss_lower": return lower(exit.d2_long)
    case "control_d1_idled_out": return exit.d1?.control?.all_gone === true
    case "control_d2_default_retained_evicted": return exit.d2_default?.control?.host_alive === true && exit.d2_default?.control?.retained === 0
    case "control_d2_long_retains": return exit.d2_long?.control?.host_alive === true && (exit.d2_long?.control?.retained ?? -1) >= 2
    default: return undefined
  }
}

function prewarmIdleExits(probes) {
  const all = Object.values(probes ?? {})
  return all.length > 0 && all.every((probe) => probe?.host_exited === true && probe?.parent_alive_at_host_exit === true)
}

function notSlower(sharded, control) {
  return typeof sharded === "number" && typeof control === "number" ? sharded <= control : null
}

function lower(variant) {
  const sharded = variant?.sharded?.alive_rss_mb_at_16min
  const control = variant?.control?.alive_rss_mb_at_16min
  return typeof sharded === "number" && typeof control === "number" ? sharded < control : null
}

/**
 * The single place a run's exit code is decided.
 * @param report { mode: "full" | "control", sections: { idle?, marginal?, totals?, idle_exit?, latency? } }
 */
export function evaluate(report, { targets = DEFAULT_TARGETS, requiredSamples = REQUIRED_SAMPLES } = {}) {
  const sections = report.sections ?? {}
  const controlOnly = report.mode === "control"
  const expected = controlOnly ? ["idle_exit"] : SECTIONS
  const missingSections = expected.filter((name) => sections[name] === undefined || sections[name] === null)
  const nulls = expected.filter((name) => !missingSections.includes(name)).flatMap((name) => nullCells(sections[name], name))
  const shortSamples = controlOnly
    ? []
    : LATENCY_SCENARIOS.filter((name) => (sections.latency?.scenarios?.[name]?.samples_ms?.length ?? 0) < requiredSamples)
        .map((name) => ({ scenario: name, samples: sections.latency?.scenarios?.[name]?.samples_ms?.length ?? 0, required: requiredSamples }))
  const rowIds = controlOnly
    ? Object.keys(CONTROL_ONLY_ROWS)
    : expected.filter((name) => !missingSections.includes(name)).flatMap((name) => SECTION_ROWS[name])
  const table = controlOnly ? CONTROL_ONLY_ROWS : targets
  const rows = rowIds.map((id) => row(id, table[id], measuredFor(id, sections) ?? null))
  const complete = missingSections.length === 0 && nulls.length === 0 && shortSamples.length === 0
  const allPass = rows.every((entry) => entry.verdict === "PASS")
  return {
    exitCode: !complete ? 1 : allPass ? 0 : 2,
    verdict: !complete ? "INCOMPLETE" : allPass ? "PASS" : "FAIL",
    completeness: { missingSections, nullCells: nulls, shortSamples, requiredSamples },
    rows,
  }
}
