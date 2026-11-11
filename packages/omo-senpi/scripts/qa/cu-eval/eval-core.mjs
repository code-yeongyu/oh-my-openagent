// Pure parts of the CU eval: verdicts, histograms, percentiles, the bench regression rule, and the SDK
// interpreter of a task plan (sdk-direct arm). Nothing here spawns a process.
import { readFileSync, existsSync } from "node:fs"

/** `fail` if any check is false, `unverified` if none is false and some could not be observed, else `pass`. */
export function judge(checks) {
  if (checks.some((check) => check.ok === false)) return "fail"
  if (checks.some((check) => check.ok === null)) return "unverified"
  return "pass"
}

/** Counts `disposition.delivery` over ActionReports (or engine trace replies). */
export function dispositionHistogram(reports) {
  const histogram = {}
  for (const report of reports) {
    const delivery = report?.disposition?.delivery ?? "none"
    histogram[delivery] = (histogram[delivery] ?? 0) + 1
  }
  return histogram
}

function mergeHistograms(histograms) {
  const merged = {}
  for (const histogram of histograms) for (const [key, count] of Object.entries(histogram)) merged[key] = (merged[key] ?? 0) + count
  return merged
}

/** Nearest-rank percentile; `null` for no samples. */
export function percentile(samples, p) {
  const sorted = samples.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

/** A p50/p95 pair over samples, rounded to 3 decimals. */
export function stats(samples) {
  const round = (value) => (value === null ? null : Math.round(value * 1000) / 1000)
  return { n: samples.length, p50: round(percentile(samples, 50)), p95: round(percentile(samples, 95)) }
}

/** Regression rule of DESIGN section 9: p50 above baseline x 1.3 fails, under an absolute floor for noise. */
const REGRESSION_RATIO = 1.3
const REGRESSION_FLOOR_MS = 0.5

/**
 * Compares a bench result with a baseline of the same host key. Every op's wall p50 is checked; a missing op is
 * a regression (the bench lost coverage), an op new in `current` is not.
 */
export function compareBench(current, baseline) {
  const regressions = []
  for (const [op, base] of Object.entries(baseline.ops ?? {})) {
    const now = current.ops?.[op]
    if (now === undefined) {
      regressions.push({ op, reason: "missing" })
      continue
    }
    const limit = base.wallMs.p50 * REGRESSION_RATIO
    if (now.wallMs.p50 > limit && now.wallMs.p50 - base.wallMs.p50 > REGRESSION_FLOOR_MS) {
      regressions.push({ op, reason: "p50", baselineP50: base.wallMs.p50, currentP50: now.wallMs.p50, limit: Math.round(limit * 1000) / 1000 })
    }
  }
  return { ok: regressions.length === 0, ratio: REGRESSION_RATIO, floorMs: REGRESSION_FLOOR_MS, regressions }
}

/** The QA control: every expected value of `expect` is made wrong, so an honest oracle must fail. */
export function mismatched(expect) {
  return Object.fromEntries(
    Object.entries(expect).map(([key, value]) => [key, typeof value === "number" ? value + 100 : `${String(value)} (mismatch)`]),
  )
}

export function readJsonLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch (error) {
        if (error instanceof SyntaxError) return []
        throw error
      }
    })
}

function named(node, name) {
  if (name === "") return true
  return node?.title === name || node?.description === name
}

/** One element of `win` by `{ role, name }`; `last` picks the last match (a calculator's result line). */
async function findElement(win, { role, name }, { last = false } = {}) {
  const matches = (await win.find({ role })).filter((element) => element.node?.role === role && named(element.node, name))
  const element = last ? matches.at(-1) : matches[0]
  if (element === undefined) throw new Error(`no ${role} named ${JSON.stringify(name)} in ${win.app} ${JSON.stringify(win.title)}`)
  return element
}

/**
 * Runs `plan` through the SDK on `win` and returns the ActionReports. `optional` steps whose element is
 * missing are skipped; `onlyIfChanged` steps run only when the remembered key moved.
 */
export async function runPlan(computer, win, plan, { remembered = {}, readback = {}, live } = {}) {
  const reports = []
  for (const step of plan) {
    if (step.onlyIfChanged !== undefined && readback[step.onlyIfChanged] === remembered[step.onlyIfChanged]) continue
    const target = step.window === undefined ? win : await computer.window(step.window)
    try {
      if (step.op === "press") reports.push(await (await findElement(target, step.el)).press())
      else if (step.op === "setValue") reports.push(await (await findElement(target, step.el)).setValue(step.value))
      else if (step.op === "type") reports.push(await (await findElement(target, step.el)).type(step.text))
      else if (step.op === "menu") reports.push(await target.menu.select(step.path))
      else if (live !== undefined && live.ops[step.op] !== undefined) reports.push(...(await live.ops[step.op](computer, target, step)))
      else throw new Error(`unknown plan op ${step.op}`)
    } catch (error) {
      if (step.optional === true) continue
      throw error
    }
  }
  return reports
}

/** Reads every readback spec into `{ key: value }`; a failed read is `null`, never a guess. */
export async function readBack(computer, win, specs) {
  const out = {}
  for (const spec of specs) {
    try {
      const target = spec.window === undefined ? win : await computer.window(spec.window)
      if (spec.menu !== undefined) {
        out[spec.key] = (await target.menu.items(spec.menu)).map((item) => item.title)
        continue
      }
      const node = await (await findElement(target, spec.el, { last: spec.last === true })).read()
      out[spec.key] = spec.field === "focused" ? node.focused : node.value
    } catch {
      out[spec.key] = null
    }
  }
  return out
}

/** The caller's session variables never reach the engine or senpi (they redirect children to installed runtimes). */
export function scrubbedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OMO|SENPI|PI)_/.test(key)))
}

function expectOf(surface, mismatch) {
  return mismatch ? mismatched(surface.expect) : surface.expect
}

/** The oracle judges what the plan left; the post-check judges the restored readback, audit, windows and files. */
export function oracleRow({ task, arm, surface, mismatch, outcome }) {
  const checks = surface.oracle({ ...outcome, expect: expectOf(surface, mismatch) }).map(normalizeCheck)
  const restored = { readback: outcome.restoredReadback, audit: outcome.restoreAudit, windows: outcome.restoredWindows, files: outcome.restoredFiles }
  const restoreChecks = (surface.postcheck({ ...outcome, ...restored }) ?? []).map(normalizeCheck)
  return {
    task: task.id,
    title: task.title,
    arm,
    status: judge(checks),
    mismatchInjected: mismatch,
    checks,
    restore: { status: judge(restoreChecks), checks: restoreChecks },
    steps: outcome.steps,
    harnessCalls: outcome.harnessCalls ?? 0,
    tokens: outcome.tokens,
    wallMs: Math.round(outcome.wallMs),
    dispositions: dispositionHistogram(outcome.reports),
    readback: outcome.readback,
  }
}

function normalizeCheck(check) {
  return { check: check.check, kind: check.kind, ok: check.ok, ...(check.why === undefined ? {} : { why: check.why }) }
}

/** Every task row's status counts plus the merged disposition histogram. */
export function summarize(rows) {
  const counts = { pass: 0, fail: 0, unverified: 0, error: 0, skipped: 0 }
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
  const restoreFailed = rows.filter((row) => row.restore?.status === "fail" || row.restore?.status === "error").map((row) => row.task)
  return {
    tasks: rows.length,
    ...counts,
    restoreFailed,
    dispositions: mergeHistograms(rows.map((row) => row.dispositions ?? {})),
    steps: rows.reduce((sum, row) => sum + (row.steps ?? 0), 0),
    wallMs: Math.round(rows.reduce((sum, row) => sum + (row.wallMs ?? 0), 0)),
  }
}

/** Exit 0 only when every task ran, none failed, and every restore post-check held. */
export function exitCodeFor(summary) {
  return summary.fail === 0 && summary.error === 0 && summary.skipped === 0 && summary.restoreFailed.length === 0 ? 0 : 1
}
