// The X1a proof's evidence: one transcript per surface (each step's input, the surface's raw answer, and what device B
// showed afterwards) and one summary table, step by surface. Every id, device id and scratch path is redacted, so the
// table can be committed and the transcripts quoted. Transcripts stay local under .omo/evidence (#8703).
import { ISSUES, NOTES, type Op, OWNERS, type Surface, SURFACES } from "./scenario.ts"

export { type Surface, SURFACES }

const SURFACE_TITLE: Readonly<Record<Surface, string>> = {
  sdk: "SDK (plain bun script)",
  tools: "Thread tools (scripted session)",
  cli: "CLI (spawned, --json)",
}

/**
 * pass: the surface answered as the contract says and B shows the expected state; fail: an assertion on the real output
 * failed; not reached: the step did not run (no call on this surface yet, the open answered no thread, an earlier step
 * stalled, or the world could not be set up), with the reason and, for planned work, the slice.
 */
export type Cell = "pass" | "fail" | "not reached"

export type StepRecord = {
  readonly step: string
  readonly op: Op
  readonly input: unknown
  readonly call: string
  readonly raw: unknown
  readonly observed: unknown
  readonly cell: Cell
  readonly why: string
  /** The slice that makes a failing or unavailable cell pass (design section 6, the step's owner). */
  readonly slice: string
}

export type Redaction = {
  readonly roots: readonly string[]
  readonly devices: Readonly<Record<string, string>>
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const LONG_HEX = /\b[0-9a-f]{12,}\b/gi
// The scenario's own QA-TOKEN-* markers are readable test data, not ids.
const BASE64URL_ID = /(?<![A-Za-z0-9_-])(?!QA-)[A-Za-z0-9_-]{22,}(?![A-Za-z0-9_-])/g

export function redact(text: string, redaction: Redaction): string {
  let out = text
  for (const root of [...redaction.roots].toSorted((a, b) => b.length - a.length)) out = out.split(root).join("<world>")
  for (const [id, label] of Object.entries(redaction.devices)) out = out.split(id).join(label)
  return out.replace(UUID, "<id>").replace(LONG_HEX, "<id>").replace(BASE64URL_ID, "<id>")
}

const fence = (value: unknown): string => ["```json", JSON.stringify(value, null, 2), "```"].join("\n")

export function transcript(surface: Surface, build: string, records: readonly StepRecord[]): string {
  const lines = [`# X1a proof transcript: ${SURFACE_TITLE[surface]}`, "", `Build under test: ${build}`, ""]
  for (const record of records) {
    lines.push(
      `## ${record.step} (${record.op}): ${record.cell}`,
      "",
      `Call: ${record.call}`,
      "",
      "Input:",
      fence(record.input),
    )
    lines.push("", "Surface answer (raw):", fence(record.raw), "", "Device B afterwards:", fence(record.observed))
    lines.push("", `Verdict: ${record.why}`, ...(record.cell === "pass" ? [] : [`Fixed by: ${record.slice}`]), "")
  }
  return lines.join("\n")
}

export function summary(
  build: string,
  steps: readonly { readonly id: string; readonly op: Op }[],
  runs: Readonly<Record<Surface, readonly StepRecord[]>>,
  notes: readonly string[] = [],
): string {
  const header = `| Step | ${SURFACES.map((surface) => SURFACE_TITLE[surface]).join(" | ")} |`
  const rule = `|---|${SURFACES.map(() => "---").join("|")}|`
  const cell = (surface: Surface, step: string): string => {
    const record = runs[surface].find((entry) => entry.step === step)
    if (record === undefined) return "surface not run (--only)"
    const note = NOTES[`${surface}:${step}`]
    const noted = note === undefined ? "" : ` [note: ${note}]`
    if (record.cell === "pass") return `pass${noted}`
    const issue = ISSUES[`${surface}:${step}`]
    const owner = record.cell === "fail" ? (OWNERS[`${surface}:${step}`] ?? record.slice) : record.slice
    return `${record.cell}: ${record.why} (${owner}${issue === undefined ? "" : `, ${issue}`})${noted}`
  }
  const rows = steps.map((step) => `| ${step.id} (${step.op}) | ${SURFACES.map((s) => cell(s, step.id)).join(" | ")} |`)
  return [
    "# X1a proof: the cross-device thread scenario on three surfaces",
    "",
    `Build under test: ${build}. Regenerate with \`bun script/qa/sdk-proof/run.ts\`.`,
    "",
    ...notes.flatMap((note) => [note, ""]),
    header,
    rule,
    ...rows,
    "",
  ].join("\n")
}
