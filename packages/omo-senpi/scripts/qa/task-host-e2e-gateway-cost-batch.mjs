/**
 * Load discipline for the gateway cost driver (plan todo 23).
 *
 * Every sample batch records the host's 1/5/15-minute load average and its compressor share before
 * and after it. A batch whose 1-minute load jumps (the peak seen during or after it is more than
 * `LOAD_JUMP_RATIO` x its starting load, or the load is above `LOAD_CEILING`) is DISCARDED: it is
 * listed with its reason and re-taken, never averaged in. Below `LOAD_FLOOR` the ratio is taken
 * against the floor, so an idle machine's sub-1 load wobble does not count as a jump.
 */
import { loadavg } from "node:os"

export const LOAD_JUMP_RATIO = 1.5
export const LOAD_CEILING = 40
export const LOAD_FLOOR = 4

const round1 = (value) => Math.round(value * 10) / 10

function sysctl(name) {
  return Bun.spawnSync(["sysctl", "-n", name]).stdout.toString().trim()
}

/** Pages occupied by the compressor as a share of physical memory (darwin `vm_stat`), else null. */
function compressorPercent() {
  if (process.platform !== "darwin") return null
  const pages = Number(/Pages occupied by compressor:\s+(\d+)/.exec(Bun.spawnSync(["vm_stat"]).stdout.toString())?.[1])
  const total = Number(sysctl("hw.memsize")) / Number(sysctl("hw.pagesize"))
  return Number.isFinite(pages) && total > 0 ? round1((pages * 100) / total) : null
}

export function hostLoad() {
  return { at: new Date().toISOString(), load: loadavg().map(round1), compressor_pct: compressorPercent() }
}

export const load1 = () => round1(loadavg()[0])

/** Why a batch is contaminated (empty when it is clean). `during` holds 1-minute loads read inside it. */
export function contamination(before, after, during = []) {
  const start = before.load[0]
  const peak = Math.max(after.load[0], ...during.filter(Number.isFinite))
  const reasons = []
  const limit = round1(LOAD_JUMP_RATIO * Math.max(start, LOAD_FLOOR))
  if (peak > limit) reasons.push(`1-min load rose ${start} -> ${peak} (limit ${limit})`)
  if (Math.max(start, peak) > LOAD_CEILING) reasons.push(`1-min load above ${LOAD_CEILING} (start ${start}, peak ${peak})`)
  return reasons
}

/** Nearest-rank stats over the finite values. */
export function stats(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return { n: 0 }
  const rank = (p) => sorted[Math.max(0, Math.ceil(p * n) - 1)]
  return { n, min: round1(sorted[0]), p50: round1(rank(0.5)), p95: round1(rank(0.95)), max: round1(sorted[n - 1]), mean: round1(sorted.reduce((a, b) => a + b, 0) / n) }
}

export const delta = (b, a) => (Number.isFinite(b) && Number.isFinite(a) ? round1(b - a) : null)

/** The soft deadline every section polls between samples; past it a section stops and reports what it has. */
export function createDeadline(atMs) {
  let stoppedIn
  return {
    at: new Date(atMs).toISOString(),
    reached(where) {
      const over = Date.now() >= atMs
      if (over && stoppedIn === undefined && where !== undefined) stoppedIn = where
      return over
    },
    get stoppedIn() {
      return stoppedIn
    },
  }
}

/** The 1-minute loads a batch's samples recorded while it ran. */
function loadsOf(samples) {
  return samples.flatMap((sample) => [sample.load1, sample.load1_start, sample.load1_end]).filter(Number.isFinite)
}

/**
 * Batches of one series. `take()` returns the batch's samples; a contaminated batch is kept in
 * `discarded` and taken again, at most `retakes` times, while the deadline allows.
 */
export function createBatches(series, { log, deadline, retakes = 1 }) {
  const accepted = []
  const discarded = []
  return {
    accepted,
    discarded,
    async run(label, take) {
      for (let attempt = 0; attempt <= retakes; attempt += 1) {
        if (deadline.reached(`${series} ${label}`)) return undefined
        const before = hostLoad()
        const samples = await take()
        const after = hostLoad()
        const reasons = contamination(before, after, loadsOf(samples))
        const batch = { series, label, attempt, before, after, samples }
        if (reasons.length === 0) {
          accepted.push(batch)
          return batch
        }
        discarded.push({ ...batch, discard_reasons: reasons })
        log(`DISCARDED ${series} ${label} attempt ${attempt}: ${reasons.join("; ")}`)
      }
      return undefined
    },
    /** The samples of every accepted batch, flattened. */
    samples() {
      return accepted.flatMap((batch) => batch.samples)
    },
    /** What the report keeps: every batch's loads beside its counts, and every discarded batch whole. */
    summary() {
      const row = (batch) => ({ label: batch.label, attempt: batch.attempt, n: batch.samples.length, load_before: batch.before.load, load_after: batch.after.load, compressor_pct_before: batch.before.compressor_pct, compressor_pct_after: batch.after.compressor_pct })
      return { accepted: accepted.map(row), discarded: discarded.map((batch) => ({ ...row(batch), discard_reasons: batch.discard_reasons, samples: batch.samples })) }
    },
  }
}
