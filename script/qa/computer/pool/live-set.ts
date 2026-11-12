// The receipt shape of the per-PR live macOS tier: one line per scenario, then one SET line, then the teardown receipts.
// A scenario passes only on its own independent oracle and must carry a refusal leg; a scenario that cannot run on the
// host is BLOCKED with its reason, never PASS and never skipped.

export const MACOS_SCENARIOS = [
  "two-window-typing",
  "chrome-two-window-typing",
  "off-space-capture",
  "dense-window-observe",
  "capture-guard",
  "permission-denied",
  "self-target",
  "frame-verbs",
  "key-hold",
  "stop-chord-physical",
  "stop-chord-posted-ignored",
  "sentinel-suite",
] as const

export type ScenarioOutcome =
  | { readonly kind: "pass"; readonly oracle: string; readonly refusalLeg: string }
  | { readonly kind: "fail"; readonly detail: string }
  | { readonly kind: "blocked"; readonly reason: string }

export type ScenarioReceipt = {
  readonly scenario: string
  readonly route: "synthetic-user" | "virtual-hid" | "none"
  readonly outcome: ScenarioOutcome
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function receiptLine(receipt: ScenarioReceipt): string {
  const { outcome } = receipt
  const head = `SCENARIO ${receipt.scenario} route=${receipt.route}`
  switch (outcome.kind) {
    case "pass":
      return `${head} PASS oracle=${oneLine(outcome.oracle)} refusal=${oneLine(outcome.refusalLeg)}`
    case "fail":
      return `${head} FAIL ${oneLine(outcome.detail)}`
    case "blocked":
      return `${head} BLOCKED reason=${oneLine(outcome.reason)}`
  }
}

const NOTHING_RAN_EXIT = 3

export type SetSummary = { readonly line: string; readonly exitCode: number }

export function summarizeSet(os: string, receipts: readonly ScenarioReceipt[]): SetSummary {
  const count = (kind: ScenarioOutcome["kind"]) => receipts.filter((receipt) => receipt.outcome.kind === kind).length
  const reasons = [
    ...new Set(
      receipts.flatMap((receipt) => (receipt.outcome.kind === "blocked" ? [oneLine(receipt.outcome.reason)] : [])),
    ),
  ]
  const blockedPart = reasons.length === 0 ? "" : ` reason=${reasons.join(",")}`
  const line = `SET ${os} pass=${count("pass")} fail=${count("fail")} blocked=${count("blocked")}${blockedPart}`
  const exitCode = count("fail") > 0 || receipts.length === 0 ? 1 : count("pass") === 0 ? NOTHING_RAN_EXIT : 0
  return { line, exitCode }
}

export function blockedSet(reason: string, route: ScenarioReceipt["route"]): ScenarioReceipt[] {
  return MACOS_SCENARIOS.map((scenario) => ({ scenario, route, outcome: { kind: "blocked", reason } }))
}
