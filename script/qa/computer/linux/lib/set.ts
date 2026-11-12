import type { Result, Scenario, SessionName } from "./scenario.ts"

export type Outcome =
  | { readonly kind: "ran"; readonly result: Result }
  | { readonly kind: "blocked"; readonly scenario: string; readonly reason: string }

/** Why `scenario` cannot run in this session, or undefined when it is admitted. */
export function admission(
  scenario: Scenario,
  session: SessionName,
  startFailure: string | undefined,
  present: (tool: string) => boolean = (tool) => Bun.which(tool) !== null,
): string | undefined {
  if (startFailure !== undefined) return `session ${session} did not start: ${startFailure}`
  if (!scenario.sessions.includes(session)) return `scenario ${scenario.name} does not run under ${session}`
  const missing = scenario.requires.filter((tool) => !present(tool))
  if (missing.length > 0) return `this host lacks ${missing.join(", ")} (the QA container has them)`
  return undefined
}

function count(outcomes: readonly Outcome[]): { pass: number; fail: number; blocked: number } {
  let pass = 0
  let fail = 0
  let blocked = 0
  for (const outcome of outcomes) {
    if (outcome.kind === "blocked") blocked += 1
    else if (outcome.result.verdict === "PASS") pass += 1
    else fail += 1
  }
  return { pass, fail, blocked }
}

export function setLine(session: SessionName, outcomes: readonly Outcome[]): string {
  const { pass, fail, blocked } = count(outcomes)
  return `SET linux/${session} pass=${pass} fail=${fail} blocked=${blocked}`
}

export function setExitCode(outcomes: readonly Outcome[]): number {
  return count(outcomes).fail > 0 ? 1 : 0
}
