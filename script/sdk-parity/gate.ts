import { type BaselineEntry, sha256 } from "./baseline"
import {
  type DeclaredChange,
  declaredProvider,
  type ExemptionProvider,
  parseDeclarations,
  printedPair,
} from "./declared-change"
import { type Goldens, type PresentationRow, presentationProblems, presentationRowProblems } from "./presentation"
import { type DeclaredVersions, equalUnderVersionMask } from "./version-mask"
import type { Outcome } from "./scenario-run"
import { callPart, type Scenario } from "./scenarios"
import type { Row } from "./schema"
import { schemaDifferences, type DiscoveredTool } from "./tool-check"

// The changed-capability gate of design 7.4 (amendments 2 and 3). A demonstrated change fails it: a descriptor or tool-schema
// change, or a base-versus-head outcome difference, under an unresolved entry, and a security-gated entry cleared without
// its slice. A candidate, where only a closure moved with every outcome equal, is a merge requirement a reviewer carries:
// the gate prints the candidates and their digest at the head, and verify-review.ts holds the verdict to that digest.

export type Side = {
  readonly rows: readonly Row[] | undefined
  readonly tools: readonly DiscoveredTool[]
  readonly outcomes: Readonly<Record<string, Outcome>>
  readonly unresolved: readonly BaselineEntry[] | undefined
}

export type GateInput = {
  readonly base: Side
  readonly head: Side & { readonly rows: readonly Row[]; readonly unresolved: readonly BaselineEntry[] }
  readonly scenarios: readonly Scenario[]
  readonly closures: ReadonlyMap<string, ReadonlySet<string>>
  readonly changedFiles: readonly string[]
  readonly body: string
  readonly headSha: string
  // presentation.json at the merge base (undefined when it has none) and at the head; only the rows the pull request
  // adds take part, so a row already on the base neither clears nor fails a later pull request.
  readonly presentation: {
    readonly base: readonly PresentationRow[] | undefined
    readonly head: readonly PresentationRow[]
  }
  readonly goldens: Goldens
  // Each tree's declared omo and engine versions (version-mask.ts); the merge base's is undefined when it has no manifest.
  readonly versions: { readonly base: DeclaredVersions | undefined; readonly head: DeclaredVersions }
  // The merge base's own scenario table (ids and capabilities); undefined when the base has none. The trees both run the
  // head's table, so a scenario the head dropped is caught here and nowhere else.
  readonly baseScenarios?: readonly Scenario[]
  // The gate's fresh-toolAhead map by capability, handed to the declared kinds (#15199).
  readonly ahead?: ReadonlyMap<string, unknown>
}

// The closed, named list of exemptions the one failing place consults (#15199). Adding a provider is a change of the
// gate's rule, read as such: a test enumerates this list.
export const EXEMPTION_PROVIDERS: Readonly<Record<string, ExemptionProvider>> = { declared: declaredProvider }

export type GateReport = {
  readonly failures: readonly string[]
  readonly candidates: readonly string[]
  readonly liveSchema: readonly string[]
  readonly presentation: readonly string[]
  readonly presentationRows: readonly string[]
  readonly versionMasked: readonly string[]
  // Scenarios the body declares changed on purpose whose kind holds: their capabilities are the class 'changed', never
  // candidates.
  readonly changed: readonly DeclaredChange[]
  // Every exempt scenario, as '<scenario>#exempt=<provider>[:<detail>]'; the digest binds each.
  readonly exempted: readonly string[]
  readonly head: string
  readonly digest: string
  readonly unchangedLine: boolean
  readonly initialization: boolean
}

const UNCHANGED_LINE = /^SDK-Parity-Unchanged:\s*yes\s*$/im
const SLICE_LINE = /^SDK-Parity-Slice:\s*(\S+)\s*$/gim

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

// Design 7.4 (amendment 3): the candidates' digest binds the head and the sorted ids, so a verdict from another head or
// over another list cannot carry it. The reviewer copies it into `SDK-Parity-Reviewed: <digest>`; nobody types the ids.
export function candidateDigest(head: string, ids: readonly string[]): string {
  return sha256(`sdk-parity-candidates v1\n${head}\n${[...ids].toSorted().join("\n")}`).slice(0, 24)
}

export const CANDIDATES_LINE =
  /^SDK-Parity-Candidates: head=([0-9a-f]{40}) digest=([0-9a-f]{24}) count=(\d+) ids=(.*)$/m

// The exemption providers are not part of the input the command-line entry builds: they are this second parameter,
// which defaults to the closed list, and only tests pass another.
export function gateReport(
  input: GateInput,
  providers: Readonly<Record<string, ExemptionProvider>> = EXEMPTION_PROVIDERS,
): GateReport {
  const baseRowsText = new Set((input.presentation.base ?? []).map((row) => JSON.stringify(row)))
  const added = input.presentation.head.filter((row) => !baseRowsText.has(JSON.stringify(row)))
  const failures: string[] = [...presentationRowProblems(added, input.scenarios)]
  const unresolved = new Set(input.head.unresolved.map((entry) => entry.id))
  const initialization = input.base.rows === undefined
  const baseRows = new Map((input.base.rows ?? []).map((row) => [row.id, row]))
  const flagged = new Set<string>()
  const presentation: string[] = []
  const presentationRows: string[] = []
  const versionMasked: string[] = []
  const declaredChanges: DeclaredChange[] = []
  // Every declaration must be judged by its kind at the one consulting place; one whose difference another branch
  // absorbed (the version mask, presentation) fails here rather than pass the gate unjudged.
  const judged = new Set<string>()
  const exempted: string[] = []
  const parsed = parseDeclarations(input.body)
  failures.push(...parsed.problems)
  const declared = new Map(parsed.declarations.map((declaration) => [declaration.scenario, declaration]))
  const scenarioById = new Map(input.scenarios.map((scenario) => [scenario.id, scenario]))
  for (const declaration of parsed.declarations) {
    const scenario = scenarioById.get(declaration.scenario)
    if (scenario === undefined)
      failures.push(`SDK-Parity-Changed: ${declaration.scenario} names no scenario the gate runs on both trees`)
    else if (!unresolved.has(scenario.capability))
      failures.push(
        `SDK-Parity-Changed: ${declaration.scenario}: its capability ${scenario.capability} is resolved; only a scenario of an unresolved capability can be declared`,
      )
  }
  // The trees both run the head's table, so the merge base's own calls are kept here: every scenario of an unresolved
  // capability stays in the head's table with the same call, or the call that differed would never run again.
  for (const scenario of input.baseScenarios ?? []) {
    if (!unresolved.has(scenario.capability)) continue
    const atHead = scenarioById.get(scenario.id)
    if (atHead === undefined)
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} is in the merge base's table and not in the head's; a scenario of an unresolved capability may not be removed or renamed`,
      )
    else if (JSON.stringify(callPart(scenario)) !== JSON.stringify(callPart(atHead)))
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} changes its call; keep the merge base's call and add a new scenario beside it`,
      )
  }
  const providerContext = {
    declarations: declared,
    outcomes: { base: input.base.outcomes, head: input.head.outcomes },
    rows: { base: input.base.rows, head: input.head.rows },
    unresolved: { base: input.base.unresolved, head: input.head.unresolved },
    tools: { base: input.base.tools, head: input.head.tools },
    ahead: input.ahead ?? new Map<string, unknown>(),
  }
  for (const row of input.head.rows) {
    if (!unresolved.has(row.id)) continue
    const before = baseRows.get(row.id)
    if (!initialization && (before === undefined || descriptorOf(before) !== descriptorOf(row))) {
      failures.push(
        `${row.id}: its descriptor changed under an unresolved gap; add the SDK call ${row.sdk} and its scenarios in this pull request`,
      )
      flagged.add(row.id)
    }
    for (const entry of row.tool) {
      const [a, b] = [input.base.tools, input.head.tools].map(
        (tools) => tools.find((tool) => tool.name === entry.name)?.parameters,
      )
      const moved = a !== undefined && b !== undefined ? schemaDifferences(a, b, entry.name) : []
      if (moved.length > 0) {
        failures.push(
          `${row.id}: tool ${entry.name} changed its input schema under an unresolved gap (${moved[0]}); add the SDK call ${row.sdk}`,
        )
        flagged.add(row.id)
      }
    }
  }
  for (const scenario of input.scenarios) {
    const [before, after] = [input.base.outcomes[scenario.id], input.head.outcomes[scenario.id]]
    if (after === undefined) {
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} has no outcome at the head; the runner did not run it`,
      )
      continue
    }
    // Both trees run the head's table, so a scenario the head adds is answered by the merge base's code too and compared
    // like any other; a missing base outcome means the runner did not run it.
    if (before === undefined) {
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} has no outcome at the merge base; the runner did not run it`,
      )
      continue
    }
    if (JSON.stringify(before) === JSON.stringify(after)) {
      if (declared.has(scenario.id)) judged.add(scenario.id)
      if (declared.has(scenario.id))
        failures.push(
          `SDK-Parity-Changed: ${scenario.id}: its outcome is equal on the merge base and the head; there is nothing to declare`,
        )
      continue
    }
    const baseVersions = input.versions.base
    if (
      baseVersions !== undefined &&
      equalUnderVersionMask(before, after, { base: baseVersions, head: input.versions.head })
    ) {
      versionMasked.push(`${scenario.id}#version-mask`)
      continue
    }
    if (unresolved.has(scenario.capability) || !baseRows.has(scenario.capability) || initialization) {
      const matched = new Set<string>()
      const notPresentation = presentationProblems(scenario, before, after, added, input.goldens, matched)
      if (notPresentation.length === 0) {
        presentation.push(scenario.id)
        presentationRows.push(`${scenario.id}#presentation=${[...matched].toSorted().join("+")}`)
        continue
      }
      judged.add(scenario.id)
      // The one place exemptions are consulted: every provider is asked, in name order, and exactly one may answer.
      const answers = Object.entries(providers)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, provider]) => [name, provider(scenario, before, after, providerContext)] as const)
        .filter(([, answer]) => answer !== undefined)
      if (answers.length > 1) {
        failures.push(
          `${scenario.capability}: scenario ${scenario.id} is exempted by more than one provider (${answers.map(([name]) => name).join(", ")}); an exemption must be unambiguous`,
        )
        flagged.add(scenario.capability)
        continue
      }
      const [only] = answers
      if (only !== undefined) {
        const [name, answer] = only
        if (answer !== undefined && "problem" in answer) {
          failures.push(answer.problem)
          flagged.add(scenario.capability)
        } else if (answer !== undefined) {
          // The gate writes the scenario and the provider's name; a provider gives only its detail, which may not carry
          // the separators the mark and the printed id list are read by.
          if (answer.detail !== undefined && /[#,\s]/.test(answer.detail.replaceAll(" ", ""))) {
            failures.push(
              `${scenario.capability}: scenario ${scenario.id}: provider ${name} answered a detail with a reserved character (# , or a line break)`,
            )
            flagged.add(scenario.capability)
          } else {
            exempted.push(`${scenario.id}#exempt=${name}${answer.detail === undefined ? "" : `:${answer.detail}`}`)
            if (answer.change !== undefined) declaredChanges.push(answer.change)
          }
        }
        continue
      }
      const why =
        "usage" in scenario && scenario.usage !== undefined
          ? `; it is not presentation-only: ${notPresentation.join("; ")}`
          : ""
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} answers differently on the merge base and the head; this pull request changes what it does without the SDK call ${scenario.capability}${why}`,
      )
      flagged.add(scenario.capability)
    }
  }
  for (const declaration of parsed.declarations) {
    const scenario = scenarioById.get(declaration.scenario)
    if (scenario !== undefined && unresolved.has(scenario.capability) && !judged.has(declaration.scenario))
      failures.push(
        `SDK-Parity-Changed: ${declaration.scenario}: its difference is admitted elsewhere (the version mask or presentation), so the declaration was never judged; remove it`,
      )
  }
  const slices = new Set([...input.body.matchAll(SLICE_LINE)].map((match) => match[1]))
  const atHead = unresolved
  for (const entry of input.base.unresolved ?? [])
    if (!atHead.has(entry.id) && entry.clearedOnlyBy !== undefined && !slices.has(entry.clearedOnlyBy))
      failures.push(
        `${entry.id}: only slice ${entry.clearedOnlyBy} clears this gap; name it with an "SDK-Parity-Slice: ${entry.clearedOnlyBy}" line or keep the entry`,
      )
  const changed = new Set(input.changedFiles)
  const annotated = input.head.rows
    .filter((row) => unresolved.has(row.id) && !flagged.has(row.id) && !initialization)
    .filter((row) => JSON.stringify(baseRows.get(row.id)) !== JSON.stringify(row))
    .map((row) => row.id)
  const closureMoved = [...input.closures]
    .filter(([id, files]) => unresolved.has(id) && !flagged.has(id) && [...files].some((file) => changed.has(file)))
    .map(([id]) => id)
  const changedCapabilities = new Set(declaredChanges.map((change) => change.capability))
  const candidates = [...new Set([...closureMoved, ...annotated])]
    .filter((id) => !changedCapabilities.has(id))
    .toSorted()
  const unchangedLine = UNCHANGED_LINE.test(input.body)
  if (unchangedLine && candidates.length === 0 && declaredChanges.length > 0)
    failures.push(
      "SDK-Parity-Unchanged: yes covers no candidate: every capability with a moved closure is declared changed",
    )
  // Design 7.4 (amendment 5, from review 6061874518): on a row whose call is BUILT, a nested requiredness or shape change
  // can change what callers may pass, so equal sampled outcomes cannot clear it. It is printed with its own mark; the
  // reviewer checks the live schema and accepted-input compatibility, and the digest covers the marked ids too.
  const liveSchema = input.head.rows
    .filter((row) => !unresolved.has(row.id) && !initialization)
    .filter((row) => {
      const before = baseRows.get(row.id)
      return before !== undefined && JSON.stringify(before.input) !== JSON.stringify(row.input)
    })
    .map((row) => row.id)
    .toSorted()
  return {
    failures,
    candidates,
    liveSchema,
    presentation: presentation.toSorted(),
    presentationRows: presentationRows.toSorted(),
    versionMasked: versionMasked.toSorted(),
    head: input.headSha,
    // Digest input order: candidates, live-schema, (changed,) presentation rows, then version-mask ids LAST. A tier
    // added later appends after these, so a merge that keeps both tiers keeps one order.
    changed: declaredChanges.toSorted((a, b) => a.scenario.localeCompare(b.scenario)),
    exempted: exempted.toSorted(),
    digest: candidateDigest(input.headSha, [
      ...candidates,
      ...liveSchema.map((id) => `${id}#live-schema`),
      ...exempted.toSorted(),
      ...presentationRows,
      ...versionMasked,
    ]),
    unchangedLine,
    initialization,
  }
}

// The committed goldens are the reviewer's view of the comparison (design 7.4); the gate never reads them as truth, and
// they must equal the head's live outcomes, so an edited golden with unchanged behaviour fails here.
export function goldenProblems(
  committed: Readonly<Record<string, Outcome>>,
  live: Readonly<Record<string, Outcome>>,
): string[] {
  const ids = new Set([...Object.keys(committed), ...Object.keys(live)])
  return [...ids]
    .toSorted()
    .filter((id) => JSON.stringify(committed[id]) !== JSON.stringify(live[id]))
    .map(
      (id) =>
        `goldens.json ${id} differs from the scenario's live outcome; regenerate with bun script/sdk-parity/scenario-run.ts --out script/sdk-parity/goldens.json`,
    )
}

// The ids a reviewer's line covers: the candidates, the built rows marked for the live-schema check and the scenarios
// passed as presentation-only.
const reviewed = (report: GateReport): string[] => [
  ...report.candidates,
  ...report.liveSchema.map((id) => `${id}#live-schema`),
  ...report.exempted,
  ...report.presentationRows,
  ...report.versionMasked,
]

export function renderReport(report: GateReport): string {
  const lines = [
    `## SDK parity gate${report.initialization ? " (initialization: the merge base has no registry)" : ""}`,
    "",
  ]
  if (report.failures.length === 0) lines.push("No failure.")
  else lines.push(`${report.failures.length} failure(s):`, "", ...report.failures.map((failure) => `- ${failure}`))
  lines.push("")
  lines.push(
    `SDK-Parity-Candidates: head=${report.head} digest=${report.digest} count=${reviewed(report).length} ids=${reviewed(report).join(",")}`,
    "",
  )
  if (report.liveSchema.length > 0)
    lines.push(
      `LIVE SCHEMA CHECK: ${report.liveSchema.join(", ")}: built calls whose input schema changed; the reviewer confirms against the live schema that the set of accepted inputs is the same in both directions (nothing newly refused, nothing newly accepted) before CLEAR.`,
      "",
    )
  if (report.presentation.length > 0)
    lines.push(
      `PRESENTATION ONLY: ${report.presentationRows.map((entry) => entry.replace("#presentation=", " (row ") + ")").join(", ")}: the usage text of an existing verb changed with the exit code, the structure and every other line equal, as named in script/sdk-parity/presentation.json; the reviewer confirms the change is wording, not a capability, before CLEAR.`,
      "",
    )
  if (report.versionMasked.length > 0)
    lines.push(
      `VERSION MASK: ${report.versionMasked.map((entry) => entry.replace("#version-mask", "")).join(", ")}: equal only once each tree's own declared omo package version and engine pin (packages/omo-native/package.json) are replaced by placeholders; the reviewer confirms the version is the only difference before CLEAR.`,
      "",
    )
  if (report.changed.length > 0)
    lines.push(
      `CHANGED ON PURPOSE: ${report.changed.length} declared scenario(s); the body's SDK-Parity-Changed lines, each held by its kind. Their capabilities are not candidates; the reviewer's digest covers them.`,
      "",
      ...report.changed.flatMap((change) => [
        `- ${change.scenario} (${change.capability}) ${[change.kind, ...change.args].join(" ")}`,
        ...printedPair(change.before, change.after),
      ]),
      "",
    )
  if (report.candidates.length === 0) lines.push("No unresolved capability is a candidate: no closure moved.")
  else
    lines.push(
      `${report.candidates.length} candidate(s): unresolved capabilities whose closure or contract annotation moved, with every descriptor and outcome equal. A merge requirement: the body carries \`SDK-Parity-Unchanged: yes\` and the reviewer's verdict at this head carries \`SDK-Parity-Reviewed: ${report.digest}\`.`,
      "",
      report.candidates.join(", "),
      "",
      report.unchangedLine
        ? "The body carries `SDK-Parity-Unchanged: yes`."
        : "MISSING: the body needs the line `SDK-Parity-Unchanged: yes`.",
    )
  return `${lines.join("\n")}\n`
}
