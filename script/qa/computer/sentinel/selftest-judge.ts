import { type DialogHit, type SentinelSummary, SIGNALS, type Signal, verdict } from "./summary.ts"

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

// The AX-only sheet trial must prove the AX attribute read and its retry: exactly one dialog hit, through the role
// branch, after at least one retried read. The answer names why the AX path is unproven, or is undefined when proven.
export function judgeAxSheetTrial(hits: readonly DialogHit[]): string | undefined {
  const [hit, ...more] = hits
  if (hit === undefined) return "the AX-only sheet was not seen as a dialog"
  if (more.length > 0) return `the AX-only sheet was seen ${hits.length} times (${hits.map((h) => h.branch).join(",")})`
  if (hit.branch !== "role")
    return `the AX-only sheet was seen only through the ${hit.branch} branch: its role read never succeeded`
  if (hit.axReads === null || hit.axReads < 2)
    return `the sheet's role read succeeded on attempt ${hit.axReads ?? "unknown"}: its retry was never exercised`
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

  const controlInvalid = verdict(negativeControl) === "invalid"
  const controlSeen = !controlInvalid && negativeControl.signals.pointer.signal === "happened"
  const controlState = controlInvalid
    ? `invalid: ${negativeControl.faults.join("; ")}`
    : controlSeen
      ? "detected"
      : "missed"
  lines.push(`SENTINEL_NEGATIVE_CONTROL pointer_warp_50px=${controlState}`)
  lines.push(`SENTINEL_SELFTEST signals=${SIGNALS.length} detected=${detected} null_false_positives=${falsePositives}`)
  const pass = complete && controlSeen && detected === SIGNALS.length && falsePositives === 0
  return { lines, exitCode: pass ? 0 : 1 }
}
