import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { type CheckResult, type Git, InputError } from "./computer-is-git.ts"

// The adoption ledger (`script/computer-adoption.tsv`) records every mechanism the ideal-state program takes from
// another project. Two markers tie the repository to it, both read here and nowhere else:
//   - a port marker `adoption-port: ADP-<n>` in a tracked file: the file carries code of that entry's source, so
//     THIRD-PARTY-NOTICES.md must hold a heading for the source (`### <source>`, optionally `@<version>`);
//   - a proof tag `[ADP-<n>]` in a tracked test or scenario (a `*.test.*`/`*.spec.*`/`*_test.rs` file, or a path
//     under `tests/`, `test/`, `qa/` or `scenarios/`): the entry is proven by a test CI runs on every pull request.

const LEDGER = "script/computer-adoption.tsv"
const NOTICES = "THIRD-PARTY-NOTICES.md"
const COLUMNS = ["id", "source", "head", "licence", "verdict", "mechanism", "rows"] as const
const VERDICTS = ["adopt", "adapt", "probe", "reject"] as const
// The ideal-state plan has 51 rows (todos 1-51); ledger rows name those, never cu-v3 rows.
const LAST_PROGRAM_ROW = 51
const PORT_MARKER = /adoption-port: (ADP-\d+)/g
const PROOF_TAG = /\[(ADP-\d+)\]/
const PROOF_PATH = /(\.(test|spec)\.[cm]?[jt]sx?$|_test\.rs$|(^|\/)(tests?|qa|scenarios?)\/)/

type Verdict = (typeof VERDICTS)[number]

type Entry = {
  readonly id: string
  readonly source: string
  readonly verdict: Verdict
  readonly rows: readonly number[]
}

type Ledger = {
  readonly entries: readonly Entry[]
  readonly problems: readonly string[]
}

const isVerdict = (value: string): value is Verdict => VERDICTS.some((verdict) => verdict === value)

function parseRows(field: string): readonly number[] | undefined {
  if (field === "") return []
  if (!/^\d+(, ?\d+)*$/.test(field)) return undefined
  return field.split(",").map((row) => Number(row.trim()))
}

function parseEntry(cells: readonly string[], seen: ReadonlySet<string>): Entry | string {
  const [id = "", source = "", head = "", licence = "", verdict = "", mechanism = "", rowsField = ""] = cells
  if (cells.length !== COLUMNS.length) return `expected ${COLUMNS.length} tab-separated columns, got ${cells.length}`
  if (!/^ADP-\d+$/.test(id)) return `id '${id}' is not ADP-<n>`
  if (seen.has(id)) return `id ${id} appears twice`
  if ([source, head, licence, mechanism].some((cell) => cell.trim() === "")) return `${id} has an empty column`
  if (!isVerdict(verdict)) return `verdict '${verdict}' is not adopt, adapt, probe or reject`
  const rows = parseRows(rowsField)
  if (rows === undefined) return `${id} rows '${rowsField}' is not a comma-separated list of row numbers`
  if (verdict === "reject" && rows.length > 0) return `${id} is rejected but names rows ${rowsField}`
  const outside = rows.find((row) => row < 1 || row > LAST_PROGRAM_ROW)
  if (outside !== undefined) return `${id} names row ${outside}, outside the program's rows 1-${LAST_PROGRAM_ROW}`
  return { id, source, verdict, rows }
}

function readLedger(cwd: string): Ledger {
  const path = join(cwd, LEDGER)
  if (!existsSync(path)) throw new InputError(`${LEDGER} does not exist`)
  const [header = "", ...lines] = readFileSync(path, "utf8").replace(/\n$/, "").split("\n")
  if (header !== COLUMNS.join("\t")) throw new InputError(`${LEDGER} header is not '${COLUMNS.join("<TAB>")}'`)
  const entries: Entry[] = []
  const problems: string[] = []
  lines.forEach((line, index) => {
    const parsed = parseEntry(line.split("\t"), new Set(entries.map((entry) => entry.id)))
    if (typeof parsed === "string") problems.push(`ADOPTION ledger line ${index + 2}: ${parsed}`)
    else entries.push(parsed)
  })
  if (entries.length === 0 && problems.length === 0) problems.push("ADOPTION ledger has no entries")
  return { entries, problems }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const hasNotice = (notices: string, source: string): boolean =>
  new RegExp(`^#{2,4} ${escapeRegExp(source)}(@\\S*)?\\s*$`, "m").test(notices)

const grepTracked = (git: Git, pattern: string): readonly string[] =>
  git(["grep", "-n", "-I", "-E", pattern, "--", "."], [0, 1])

const hitPath = (hit: string): string => hit.slice(0, hit.indexOf(":"))

function noticeFindings(cwd: string, git: Git, entries: readonly Entry[]): readonly string[] {
  const noticesPath = join(cwd, NOTICES)
  const notices = existsSync(noticesPath) ? readFileSync(noticesPath, "utf8") : ""
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const findings = new Set<string>()
  for (const hit of grepTracked(git, "adoption-port: ADP-[0-9]+")) {
    for (const match of hit.matchAll(PORT_MARKER)) {
      const id = match[1] ?? ""
      const entry = byId.get(id)
      if (entry === undefined) findings.add(`ADOPTION ${hitPath(hit)} carries ${id}, which is not in the ledger`)
      else if (!hasNotice(notices, entry.source))
        findings.add(
          `ADOPTION ${hitPath(hit)} carries ${id} (${entry.source}) without a ${entry.source} notice in ${NOTICES}`,
        )
    }
  }
  return [...findings]
}

export function adoptionSummary(cwd: string, git: Git): CheckResult {
  const { entries, problems } = readLedger(cwd)
  const taken = entries.filter((entry) => entry.verdict !== "reject")
  const uncovered = taken
    .filter((entry) => entry.rows.length === 0)
    .map((entry) => `ADOPTION ${entry.id} taken by no row`)
  const notices = noticeFindings(cwd, git, entries)
  const summary = `ADOPTION entries=${entries.length} covered=${taken.length - uncovered.length} notices=${notices.length === 0 ? "ok" : "missing"}`
  const findings = [...problems, ...uncovered, ...notices]
  return { exitCode: findings.length === 0 ? 0 : 1, lines: [summary, ...findings] }
}

function provenIds(git: Git): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const hit of grepTracked(git, "\\[ADP-[0-9]+\\]")) {
    if (!PROOF_PATH.test(hitPath(hit))) continue
    for (const match of hit.matchAll(new RegExp(PROOF_TAG.source, "g"))) ids.add(match[1] ?? "")
  }
  return ids
}

export function adoptionRow(cwd: string, git: Git, row: number): CheckResult {
  const { entries, problems } = readLedger(cwd)
  const proven = provenIds(git)
  const forRow = entries.filter((entry) => entry.rows.includes(row))
  const unproven = forRow
    .filter((entry) => !proven.has(entry.id))
    .map((entry) => `ADOPTION row=${row} ${entry.id} has no tagged test or scenario`)
  const summary = `ADOPTION row=${row} entries=${forRow.length} proven=${forRow.length - unproven.length}`
  const empty = forRow.length === 0 ? [`ADOPTION row=${row} takes no ledger entry`] : []
  const findings = [...problems, ...empty, ...unproven]
  return { exitCode: findings.length === 0 ? 0 : 1, lines: [summary, ...findings] }
}
