// The receipt shape of the per-PR live macOS tier: one line per scenario, then one SET line, then the teardown receipts.
// A scenario passes only on its own independent oracle and must carry a refusal leg; a scenario that cannot run on the
// host is BLOCKED with its reason, never PASS and never skipped. The set also records the pool host's readings
// (R-S4-1): a pass under a 1-minute load above the core count is DEGRADED, never a green pass, and a set whose passes
// are all degraded exits as red as one where nothing ran.

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
  readonly durationMs: number
  readonly outcome: ScenarioOutcome
}

// The pool host's readings the SET line records (R-S4-1). The caller passes them in; this module never reads the
// real machine, so a set's verdicts stay deterministic in tests.
export type HostReadings = {
  readonly load: number
  readonly cores: number
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

// R-S4-1: a leg run while the host's 1-minute load exceeds its core count is degraded, not a pass.
function degradedPass(receipt: ScenarioReceipt, host: HostReadings): boolean {
  return receipt.outcome.kind === "pass" && host.load > host.cores
}

export function receiptLine(receipt: ScenarioReceipt, host: HostReadings): string {
  const { outcome } = receipt
  const head = `SCENARIO ${receipt.scenario} route=${receipt.route}`
  const tail = ` durationMs=${receipt.durationMs}`
  switch (outcome.kind) {
    case "pass":
      return `${head} ${degradedPass(receipt, host) ? "DEGRADED" : "PASS"} oracle=${oneLine(outcome.oracle)} refusal=${oneLine(outcome.refusalLeg)}${tail}`
    case "fail":
      return `${head} FAIL ${oneLine(outcome.detail)}${tail}`
    case "blocked":
      return `${head} BLOCKED reason=${oneLine(outcome.reason)}${tail}`
  }
}

const NOTHING_RAN_EXIT = 3

// Nearest-rank p99 over the recorded durations; with today's 12-scenario set that is the slowest scenario.
function p99Ms(receipts: readonly ScenarioReceipt[]): number {
  if (receipts.length === 0) return 0
  const sorted = receipts.map((receipt) => receipt.durationMs).sort((a, b) => a - b)
  const rank = Math.ceil(0.99 * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0
}

function formatLoad(load: number): string {
  return String(Math.round(load * 100) / 100)
}

export type SetSummary = { readonly line: string; readonly exitCode: number }

export function summarizeSet(os: string, receipts: readonly ScenarioReceipt[], host: HostReadings): SetSummary {
  const count = (kind: ScenarioOutcome["kind"]) => receipts.filter((receipt) => receipt.outcome.kind === kind).length
  const degraded = receipts.filter((receipt) => degradedPass(receipt, host)).length
  const passes = count("pass") - degraded
  const reasons = [
    ...new Set(
      receipts.flatMap((receipt) => (receipt.outcome.kind === "blocked" ? [oneLine(receipt.outcome.reason)] : [])),
    ),
  ]
  const blockedPart = reasons.length === 0 ? "" : ` reason=${reasons.join(",")}`
  const line = `SET ${os} pass=${passes} fail=${count("fail")} blocked=${count("blocked")} degraded=${degraded}${blockedPart} hostLoad=${formatLoad(host.load)} cores=${host.cores} p99Ms=${p99Ms(receipts)}`
  // R-S4-1: a set whose passes are all degraded is as red as one where nothing passed.
  const exitCode = count("fail") > 0 || receipts.length === 0 ? 1 : passes === 0 ? NOTHING_RAN_EXIT : 0
  return { line, exitCode }
}

export function blockedSet(reason: string, route: ScenarioReceipt["route"]): ScenarioReceipt[] {
  return MACOS_SCENARIOS.map((scenario) => ({ scenario, route, durationMs: 0, outcome: { kind: "blocked", reason } }))
}
