// Planner ruling R57: after a row-scoped replay of the corpus (`replay.ts --dir <dir> --row <N> --plan <plan.md>`),
// every case that did not replay clean is either FAIL or owed to a later row, looked up in the
// parity ledgers of crates/omo-computer-core/parity/:
//   (a) a `v3-*` case FAILs when a row <= N created it: `v3-r<NN>-*` names its row NN; any other
//       `v3-*` case in the row-N checkout was added by row N or a row merged into it, so <= N.
//       (A superseded case is SKIPPED, never replayed, so it never reaches here.)
//   (b) an imported case FAILs when a ledger marks it passed or due at N or a transitive blocker of
//       N, read from the plan's `Blocked by:` lines (ruling R57e; a lower-numbered row that is not
//       in N's ancestry is not merged into N and is not due there):
//       test-parity-manifest.tsv (its `fixture` row, keyed by the old path ORACLE-PROVENANCE.tsv
//       maps the case to, or a `ported:<case>` status) with any status but `pending` is passed;
//       a DEFERRED-LEGS.tsv leg that names the case's file is passed (`passed:*`) or due at its
//       `owed to row`. An ORACLE-DELTAS.tsv `row` is the row that recorded a delta, not a row the
//       case is due at, so ORACLE-DELTAS neither makes a case due nor owns it (ruling R57c).
//   (c) otherwise, with every owner due at a row outside N's ancestry, it is `owed <case> row <M>`,
//       M the latest of them;
//   (d) a case no ledger owns with a row (a `pending` manifest row carries none) FAILs `unowned`.
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { InputError } from "./replay-case"

export type Outcome = { readonly name: string; readonly status: "ok" | "skipped" | "failed" }
export type Ledgers = {
  readonly manifest: string
  readonly provenance: string
  readonly deltas: string
  readonly deferred: string
}
export type Classified = { readonly lines: readonly string[]; readonly failing: number }

type Owner = { readonly source: string; readonly row: number | "passed" }
type Table = readonly Readonly<Record<string, string>>[]

// The data lines of a TSV keyed by its header; `#` lines and blank lines are not data.
function table(text: string): Table {
  const lines = text.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"))
  const header = (lines[0] ?? "").split("\t")
  return lines.slice(1).map((line) => {
    const cells = line.split("\t")
    return Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ""]))
  })
}

const rowOf = (cell: string | undefined) => {
  const row = Number(cell)
  return Number.isInteger(row) && row > 0 ? row : undefined
}

// `name` appears in `text` as a whole file name, not as the tail of a longer one.
const names = (text: string, name: string) =>
  new RegExp(`(^|[^\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w.-])`).test(text)

function ownersOf(name: string, ledgers: Ledgers): Owner[] {
  const file = basename(name)
  const old = new Set(
    table(ledgers.provenance)
      .filter((line) => line["new path"] === name)
      .map((line) => line["old path"]),
  )
  const owners: Owner[] = []
  for (const line of table(ledgers.manifest)) {
    const status = line.status ?? ""
    const mine = (line.kind === "fixture" && old.has(line["test id"])) || status === `ported:${name}`
    if (mine && status !== "pending") owners.push({ source: `test-parity-manifest ${status}`, row: "passed" })
  }
  for (const line of table(ledgers.deferred)) {
    if (!names(line.leg ?? "", file)) continue
    const status = line.status ?? ""
    const row = rowOf(line["owed to row"])
    const source = `DEFERRED-LEGS ${line["design row"]} recorded by row ${line["recorded by row"]}`
    if (status.startsWith("passed:")) owners.push({ source: `${source} ${status}`, row: "passed" })
    else if (row !== undefined) owners.push({ source, row })
  }
  return owners
}

// Row N and every row it is transitively blocked by. The plan lists each row as a header
// `- [ ] <N>. <title>` followed by a line carrying `Blocked by: <rows, comma separated, or ->`.
function ancestryOf(plan: string, row: number): ReadonlySet<number> {
  const blockedBy = new Map<number, number[]>()
  let current: number | undefined
  for (const line of plan.split("\n")) {
    const header = /^- \[[ xX]\] (\w+)\. /.exec(line)
    if (header) {
      current = rowOf(header[1])
      if (current !== undefined) blockedBy.set(current, [])
      continue
    }
    const blockers = /Blocked by:([^|]*)/.exec(line)
    if (current === undefined || !blockers) continue
    blockedBy.set(
      current,
      (blockers[1] ?? "").split(",").flatMap((cell) => rowOf(cell.trim()) ?? []),
    )
  }
  if (!blockedBy.has(row)) throw new InputError(`the plan lists no row ${row}`)
  const ancestry = new Set<number>()
  const visit = (n: number) => {
    if (ancestry.has(n)) return
    ancestry.add(n)
    for (const blocker of blockedBy.get(n) ?? []) visit(blocker)
  }
  visit(row)
  return ancestry
}

// One verdict line for a case that did not replay clean; `ancestry` is row N and its blockers.
function verdict(
  row: number,
  ancestry: ReadonlySet<number>,
  name: string,
  ledgers: Ledgers,
): { line: string; failing: boolean } {
  const fail = (reason: string) => ({ line: `FAIL ${name} ${reason}`, failing: true })
  const file = basename(name)
  if (file.startsWith("v3-")) {
    const named = /^v3-r(\d+)-/.exec(file)
    const created = named ? Number(named[1]) : row
    if (created <= row)
      return fail(named ? `v3 case of row ${created} <= ${row}` : `v3 case created at or before row ${row}`)
  }
  const owners = ownersOf(name, ledgers)
  const passed = owners.find((owner) => owner.row === "passed")
  if (passed) return fail(`passed in ${passed.source}`)
  const due = owners.find((owner) => typeof owner.row === "number" && ancestry.has(owner.row))
  if (due) return fail(`due at row ${due.row} (row ${row} or a blocker of it) in ${due.source}`)
  const rows = owners.flatMap((owner) => (typeof owner.row === "number" ? [owner.row] : []))
  if (rows.length === 0) return fail("unowned")
  return { line: `owed ${name} row ${Math.max(...rows)}`, failing: false }
}

export function classify(row: number, outcomes: readonly Outcome[], ledgers: Ledgers, plan: string): Classified {
  const ancestry = ancestryOf(plan, row)
  const lines: string[] = []
  let failing = 0
  for (const outcome of outcomes) {
    if (outcome.status !== "failed") continue
    const result = verdict(row, ancestry, outcome.name, ledgers)
    lines.push(result.line)
    if (result.failing) failing++
  }
  const count = (status: Outcome["status"]) => outcomes.filter((outcome) => outcome.status === status).length
  const owed = lines.length - failing
  lines.push(`replay-all R57 row=${row}: ok=${count("ok")} skipped=${count("skipped")} failing=${failing} owed=${owed}`)
  return { lines, failing }
}

// The four ledgers under `parity`; a missing ledger is an input error of the caller.
export async function readLedgers(parity: string): Promise<Ledgers> {
  const read = (file: string) => readFile(join(parity, file), "utf8")
  const [manifest, provenance, deltas, deferred] = await Promise.all([
    read("test-parity-manifest.tsv"),
    read("ORACLE-PROVENANCE.tsv"),
    read("ORACLE-DELTAS.tsv"),
    read("DEFERRED-LEGS.tsv"),
  ])
  return { manifest, provenance, deltas, deferred }
}
