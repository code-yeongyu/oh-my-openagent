import type { ToolAhead } from "./baseline"
import type { Row } from "./schema"
import { descriptorAheadProblems, toolSchemaAheadProblems, withoutAhead } from "./tool-ahead"
import { schemaDifferences, type DiscoveredTool } from "./tool-check"

// Design 7.4 (amendment 5): a row has two parts. Its DESCRIPTOR is what a surface accepts or calls: the sdk member, each
// cli entry, each tool binding, which input fields exist and which are required, plus its kind, today
// value, surfaces, projection and modules. Any change there under an unresolved entry fails. Everything else (a named
// field's type, enum, nested schema, scenario ids, notes) is CONTRACT ANNOTATION: its change alone makes a candidate.
function descriptorOf(row: Row): string {
  const shape = [
    ...Object.keys(row.input.properties).map((name) => `field ${name}`),
    ...row.input.required.map((name) => `required ${name}`),
  ]
  const { id, kind, sdk, today, slices, cli, tool, planned, omitted, projection, modules } = row
  return JSON.stringify({
    id,
    kind,
    sdk,
    today,
    slices,
    cli,
    tool,
    planned,
    omitted,
    projection,
    modules,
    shape: [...new Set(shape)].toSorted(),
  })
}

// A row answers for the fields its tool branch reads or is chosen by; a tool field no branch reads is toolProblems' to
// refuse, so another branch's new field does not change this row.
function branchSchema(
  parameters: DiscoveredTool["parameters"],
  fields: ReadonlySet<string>,
): DiscoveredTool["parameters"] {
  return {
    ...parameters,
    properties: Object.fromEntries(Object.entries(parameters.properties ?? {}).filter(([name]) => fields.has(name))),
    required: (parameters.required ?? []).filter((name) => fields.has(name)),
  }
}

export type RowJudgement = {
  readonly failures: readonly string[]
  readonly ahead: boolean
}

// One row under an unresolved entry: its descriptor and each tool branch's schema against the merge base. A change fails
// unless the entry's toolAhead, added in this pull request, admits it.
export function judgeUnresolvedRow(
  row: Row,
  before: Row | undefined,
  ahead: ToolAhead | undefined,
  tools: { readonly base: readonly DiscoveredTool[]; readonly head: readonly DiscoveredTool[] },
  initialization: boolean,
): RowJudgement {
  const failures: string[] = []
  const admitted =
    ahead !== undefined &&
    before !== undefined &&
    descriptorAheadProblems(before, row, ahead).length === 0 &&
    descriptorOf(withoutAhead(before, ahead)) === descriptorOf(withoutAhead(row, ahead))
  let aheadRow = admitted && descriptorOf(before) !== descriptorOf(row)
  if (!initialization && !admitted && (before === undefined || descriptorOf(before) !== descriptorOf(row)))
    failures.push(
      `${row.id}: its descriptor changed under an unresolved gap; add the SDK call ${row.sdk} and its scenarios in this pull request`,
    )
  for (const entry of row.tool) {
    const branchFields = new Set([...entry.reads, ...entry.when.present, ...entry.when.absent])
    const [a, b] = [tools.base, tools.head].map((list) => {
      const parameters = list.find((tool) => tool.name === entry.name)?.parameters
      return parameters === undefined ? undefined : branchSchema(parameters, branchFields)
    })
    if (a === undefined || b === undefined) continue
    const moved = schemaDifferences(a, b, entry.name)
    if (moved.length === 0) continue
    const beyond = ahead === undefined ? moved : toolSchemaAheadProblems(a, b, ahead, entry.name)
    if (beyond.length === 0) aheadRow = true
    else
      failures.push(
        `${row.id}: tool ${entry.name} changed its input schema under an unresolved gap (${beyond[0]}); add the SDK call ${row.sdk}`,
      )
  }
  return { failures, ahead: aheadRow }
}
