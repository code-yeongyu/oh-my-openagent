import { type SentinelSummary, SIGNALS, type Signal, verdict } from "./summary.ts"

// The self-test is the proof that every detector can fail: each planted disturbance must read `happened` on exactly
// its own signal, a null run must read `none` on all eight, and the 50 px warp-and-return must be seen.

export const PLANT_NOUN: Readonly<Record<Signal, string>> = {
  key_focus: "focus steal",
  window_raised: "raise",
  typing: "dropped keystroke",
  pointer: "pointer move",
  clipboard: "pasteboard write",
  space: "Space switch",
  dialog: "alert",
  activation: "activation",
}

export type Trial =
  | { readonly plant: Signal | null; readonly summary: SentinelSummary }
  | { readonly plant: Signal; readonly failed: string }

type SelfTestResult = { readonly lines: readonly string[]; readonly exitCode: 0 | 1 }

const happenedOn = (summary: SentinelSummary): Signal[] =>
  SIGNALS.filter((signal) => summary.signals[signal].signal === "happened")

function plantProblem(trial: Trial & { readonly plant: Signal }): string | undefined {
  const noun = PLANT_NOUN[trial.plant]
  if ("failed" in trial) return `plant ${noun} could not be performed: ${trial.failed}`
  if (verdict(trial.summary) === "invalid") return `plant ${noun} run invalid: ${trial.summary.faults.join("; ")}`
  const hits = happenedOn(trial.summary)
  if (!hits.includes(trial.plant)) return `detector ${trial.plant} missed the planted ${noun}`
  const others = hits.filter((signal) => signal !== trial.plant)
  if (others.length > 0) return `plant ${trial.plant} also read happened on ${others.join(",")}`
  return undefined
}

export function judgeSelfTest(trials: readonly Trial[], negativeControl: SentinelSummary): SelfTestResult {
  const lines: string[] = []
  let detected = 0
  let falsePositives = 0
  let complete = true

  const nulls = trials.filter((trial) => trial.plant === null)
  if (nulls.length === 0) {
    lines.push("null run missing")
    complete = false
  }
  for (const trial of nulls) {
    if ("failed" in trial) continue
    if (verdict(trial.summary) === "invalid") {
      lines.push(`null run invalid: ${trial.summary.faults.join("; ")}`)
      complete = false
    }
    falsePositives += happenedOn(trial.summary).length
  }

  for (const signal of SIGNALS) {
    const planted = trials.filter((trial): trial is Trial & { readonly plant: Signal } => trial.plant === signal)
    if (planted.length === 0) {
      lines.push(`plant ${PLANT_NOUN[signal]} missing`)
      continue
    }
    const problems = planted.map(plantProblem).filter((problem) => problem !== undefined)
    lines.push(...problems)
    if (problems.length === 0) detected++
  }

  const controlSeen = verdict(negativeControl) !== "invalid" && negativeControl.signals.pointer.signal === "happened"
  lines.push(`SENTINEL_NEGATIVE_CONTROL pointer_warp_50px=${controlSeen ? "detected" : "missed"}`)
  lines.push(`SENTINEL_SELFTEST signals=${SIGNALS.length} detected=${detected} null_false_positives=${falsePositives}`)
  const pass = complete && controlSeen && detected === SIGNALS.length && falsePositives === 0
  return { lines, exitCode: pass ? 0 : 1 }
}
