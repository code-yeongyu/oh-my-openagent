import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type CheckResult, type Git, InputError } from "./computer-is-git.ts"

// A gate names cu-v3 rows and artifact paths. A row is merged when the integration branch's FIRST-PARENT line
// holds a pull-request merge whose head branch is `<prefix>/cu-v3-row<N>-<slug>`: a pull request merged into
// another branch only reaches that line when its target branch lands, and then only as a second parent.

const GATE_CONFIG = "script/computer-is-gates.json"
const ROW_MERGE_SUBJECT = /^Merge pull request #\d+ from [^/\s]+\/[^/\s]+\/cu-v3-row(\d+)-/

export class GateConfigError extends InputError {}

type Gate = {
  readonly name: string
  readonly rows: readonly number[]
  readonly artifacts: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRowList = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((row: unknown) => typeof row === "number" && Number.isInteger(row) && row > 0)

const isPathList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((path: unknown) => typeof path === "string" && path.length > 0)

function parseGate(name: string, value: unknown): Gate {
  if (!isRecord(value)) throw new GateConfigError(`gate ${name} is not an object`)
  const { rows, artifacts } = value
  if (!isRowList(rows)) throw new GateConfigError(`gate ${name}: rows must be a list of positive integers`)
  if (!isPathList(artifacts)) throw new GateConfigError(`gate ${name}: artifacts must be a list of repository paths`)
  if (rows.length === 0 && artifacts.length === 0)
    throw new GateConfigError(`gate ${name}: has no rows and no artifacts to check`)
  return { name, rows, artifacts }
}

export function readGates(cwd: string): readonly Gate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(cwd, GATE_CONFIG), "utf8"))
  } catch (error) {
    if (error instanceof Error) throw new GateConfigError(`${GATE_CONFIG}: ${error.message}`)
    throw error
  }
  if (!isRecord(parsed) || !isRecord(parsed.gates))
    throw new GateConfigError(`${GATE_CONFIG}: expected { "gates": { ... } }`)
  return Object.entries(parsed.gates).map(([name, value]) => parseGate(name, value))
}

function mergedRows(git: Git, ref: string): ReadonlySet<number> {
  git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
  const rows = new Set<number>()
  for (const subject of git(["log", "--first-parent", "--merges", "--format=%s", ref, "--"])) {
    const row = ROW_MERGE_SUBJECT.exec(subject)?.[1]
    if (row !== undefined) rows.add(Number(row))
  }
  return rows
}

const artifactExists = (git: Git, ref: string, path: string): boolean =>
  git(["ls-tree", "--name-only", ref, "--", path]).length > 0

export function checkGate(git: Git, gate: Gate, ref: string): CheckResult {
  const merged = mergedRows(git, ref)
  const missing = [
    ...gate.rows.filter((row) => !merged.has(row)).map(String),
    ...gate.artifacts.filter((path) => !artifactExists(git, ref, path)).map((path) => `path:${path}`),
  ]
  if (missing.length === 0)
    return { exitCode: 0, lines: [`GATE ${gate.name} PASS rows=${gate.rows.join(",")} missing=0`] }
  return { exitCode: 1, lines: [`GATE ${gate.name} FAIL missing=${missing.join(",")}`] }
}

export const listGates = (gates: readonly Gate[]): CheckResult => ({
  exitCode: 0,
  lines: gates.map((gate) => `GATE ${gate.name} rows=${gate.rows.join(",")} artifacts=${gate.artifacts.length}`),
})
