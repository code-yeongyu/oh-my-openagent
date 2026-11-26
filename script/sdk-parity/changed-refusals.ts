import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ToolAhead } from "./baseline"
import { REPO_ROOT } from "./registry"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import type { Row } from "./schema"
import type { DiscoveredTool } from "./tool-check"

// A refusal whose advice changes on purpose (LEAD ruling on #15076, 2026-11-26): next_action is what an agent acts on, so
// a pull request that changes it declares the scenario here. In the pull request that adds the entry, and no later one,
// the scenario may answer differently only in next_action and details: both trees refuse, with the same code and the same
// message. A `bound` entry declares the one message change a widened lower bound causes (`>= from` becoming `>= to` in the
// host's refusal), admitted only when the row's fresh toolAhead widens that field and the tool's minimum moved so.

export const CHANGED_REFUSALS_PATH = "script/sdk-parity/changed-refusals.json"

export type ChangedRefusal = {
  readonly scenario: string
  readonly pr: string
  readonly reason: string
  readonly bound?: { readonly field: string; readonly from: number; readonly to: number }
}

export function loadChangedRefusals(text?: string): ChangedRefusal[] {
  const raw = text ?? readFileSync(join(REPO_ROOT, CHANGED_REFUSALS_PATH), "utf8")
  return (JSON.parse(raw) as { entries: ChangedRefusal[] }).entries
}

export function freshRefusals(
  head: readonly ChangedRefusal[],
  base: readonly ChangedRefusal[] | undefined,
): ReadonlyMap<string, ChangedRefusal> {
  const onBase = new Set((base ?? []).map((entry) => entry.scenario))
  return new Map(head.filter((entry) => !onBase.has(entry.scenario)).map((entry) => [entry.scenario, entry]))
}

type Refusal = { readonly code: unknown; readonly message: unknown }

function refusalOf(outcome: Outcome | undefined): Refusal | undefined {
  const result = outcome?.result as { kind?: unknown; error?: { code?: unknown; message?: unknown } } | undefined
  if (result?.kind !== "error" || result.error === undefined) return undefined
  return { code: result.error.code, message: result.error.message }
}

function minimumOf(tools: readonly DiscoveredTool[], tool: string, field: string): unknown {
  return (
    tools.find((entry) => entry.name === tool)?.parameters.properties?.[field] as { minimum?: unknown } | undefined
  )?.minimum
}

export type RefusalContext = {
  readonly ahead: ToolAhead | undefined
  readonly tools: { readonly base: readonly DiscoveredTool[]; readonly head: readonly DiscoveredTool[] }
}

export function changedRefusalProblem(
  entry: ChangedRefusal,
  scenario: Scenario,
  before: Outcome,
  after: Outcome,
  context: RefusalContext,
): string | undefined {
  if (entry.bound !== undefined) {
    const { field, from, to } = entry.bound
    if (scenario.surface !== "tool") return "a bound entry names a scenario that is not a tool call"
    if (context.ahead?.widened?.includes(field) !== true)
      return `its row's toolAhead entry, added in this pull request, does not widen ${field}`
    if (
      minimumOf(context.tools.base, scenario.tool, field) !== from ||
      minimumOf(context.tools.head, scenario.tool, field) !== to
    )
      return `the tool's ${field} minimum did not move from ${from} to ${to}`
    const [a, b] = [before.threw, after.threw]
    if (typeof a !== "string" || typeof b !== "string" || !a.includes(`>= ${from}`))
      return `both trees must refuse it in the host with the bound >= ${from} on the base`
    return a.split(`>= ${from}`).join(`>= ${to}`) === b ? undefined : "its refusal changed beyond the declared bound"
  }
  const [a, b] = [refusalOf(before), refusalOf(after)]
  if (a === undefined || b === undefined) return "it is no longer a refusal on both trees"
  if (a.code !== b.code) return "its error code changed"
  if (a.message !== b.message) return "its message changed"
  return undefined
}

export function changedRefusalEntryProblems(
  fresh: ReadonlyMap<string, ChangedRefusal>,
  scenarios: readonly Scenario[],
  outcomes: { readonly base: Readonly<Record<string, Outcome>>; readonly head: Readonly<Record<string, Outcome>> },
): string[] {
  const ids = new Set(scenarios.map((scenario) => scenario.id))
  const problems: string[] = []
  for (const id of fresh.keys()) {
    if (!ids.has(id)) problems.push(`${CHANGED_REFUSALS_PATH} names scenario ${id}, which does not exist`)
    else if (JSON.stringify(outcomes.base[id]) === JSON.stringify(outcomes.head[id]))
      problems.push(
        `${CHANGED_REFUSALS_PATH} names scenario ${id}, which answers the same on both trees; remove the stale entry`,
      )
  }
  return problems
}

export function unknownFieldCoverageProblems(rows: readonly Row[], scenarios: readonly Scenario[]): string[] {
  const tools = new Set(
    rows.flatMap((row) => row.tool.map((entry) => entry.name)).filter((name) => name.startsWith("thread_")),
  )
  const covered = new Set(
    scenarios.flatMap((scenario) =>
      scenario.surface === "tool" && scenario.unknownField === true ? [scenario.tool] : [],
    ),
  )
  return [...tools]
    .toSorted()
    .filter((tool) => !covered.has(tool))
    .map((tool) => `tool ${tool} has no unknown-field scenario; it is generated from the rows (scenarios.ts)`)
}
