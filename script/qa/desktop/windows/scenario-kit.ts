// The scenario contract shared by every Windows QA scenario: one JSONL line
// `{scenario, pass, reason?, facts, observer: {before, after}}`, where `reason` names the first
// failed check.
import { Engine, type JsonObject } from "./engine"
import type { QaWorkspace } from "./fixtures"
import type { Observation } from "./observer"

export const SABOTAGE_MODES = ["invalid-chord"] as const
export type Sabotage = (typeof SABOTAGE_MODES)[number]

export interface ScenarioContext {
  readonly binary: string
  readonly workspace: QaWorkspace
  readonly sabotage: Sabotage | undefined
}

export interface ScenarioOutcome {
  readonly pass: boolean
  readonly reason?: string
  readonly facts: JsonObject
  readonly observer: { readonly before: JsonObject | null; readonly after: JsonObject | null }
}

export interface Scenario {
  readonly name: string
  readonly run: (context: ScenarioContext) => Promise<ScenarioOutcome>
}

/** Ordered `[check, passed]` pairs; the first failed check becomes the reason. */
export type Checks = ReadonlyArray<readonly [string, boolean]>

export interface Verdict {
  readonly checks: Checks
  readonly facts: JsonObject
  readonly before: Observation | null
  readonly after: Observation | null
}

export function verdict({ checks, facts, before, after }: Verdict): ScenarioOutcome {
  const failed = checks.find(([, passed]) => !passed)
  const checkFacts: JsonObject = {}
  for (const [name, passed] of checks) checkFacts[name] = passed
  return {
    pass: failed === undefined,
    ...(failed === undefined ? {} : { reason: failed[0] }),
    facts: { ...facts, checks: checkFacts },
    observer: { before: before?.raw ?? null, after: after?.raw ?? null },
  }
}

export async function withEngine<T>(
  context: ScenarioContext,
  body: (engine: Engine) => Promise<T>,
  binary = context.binary,
): Promise<T> {
  const engine = Engine.spawn(binary)
  context.workspace.trackEngine(engine)
  try {
    return await body(engine)
  } finally {
    context.workspace.receipt(await engine.close())
  }
}

export function marker(tag: string): string {
  return `omoqa${tag}${Date.now()}`
}
