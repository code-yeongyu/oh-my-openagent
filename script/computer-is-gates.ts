// Gate checker of the computer-use ideal-state program (plan row 1).
//
//   --list                          every gate with its cu-v3 rows and artifact count
//   --gate <name> [--ref <ref>]     PASS when every row of the gate merged into <ref> (default origin/dev) and every
//                                   artifact exists there; FAIL names the missing rows and paths
//   --adoption [--row <n>]          the adoption ledger: coverage and notices, or one row's tagged proofs
//
// Exit 0 on pass, 1 on a failure (an unreadable repository or config is a failure, never a pass), 2 on a usage
// error or an unknown gate.

import { adoptionRow, adoptionSummary } from "./computer-is-adoption.ts"
import { checkGate, GateConfigError, listGates, readGates } from "./computer-is-gate-check.ts"
import { type CheckResult, gitIn, InputError, type RunOptions } from "./computer-is-git.ts"

const DEFAULT_REF = "origin/dev"

const USAGE = "usage: bun script/computer-is-gates.ts --list | --gate <name> [--ref <ref>] | --adoption [--row <n>]"

type Command =
  | { readonly kind: "list" }
  | { readonly kind: "gate"; readonly name: string; readonly ref: string }
  | { readonly kind: "adoption"; readonly row: number | undefined }

function parse(args: readonly string[]): Command | undefined {
  const [command, first, second, third, ...rest] = args
  if (rest.length > 0) return undefined
  if (command === "--list" && first === undefined) return { kind: "list" }
  if (command === "--gate" && first !== undefined && !first.startsWith("--")) {
    if (second === undefined) return { kind: "gate", name: first, ref: DEFAULT_REF }
    if (second === "--ref" && third !== undefined) return { kind: "gate", name: first, ref: third }
    return undefined
  }
  if (command === "--adoption" && third === undefined) {
    if (first === undefined) return { kind: "adoption", row: undefined }
    if (first === "--row" && second !== undefined && /^[1-9]\d*$/.test(second))
      return { kind: "adoption", row: Number(second) }
  }
  return undefined
}

function failureLine(command: Command, error: InputError): string {
  if (error instanceof GateConfigError) return `GATE config ERROR ${error.message}`
  switch (command.kind) {
    case "list":
      return `GATE config ERROR ${error.message}`
    case "gate":
      return `GATE ${command.name} ERROR ${error.message}`
    case "adoption":
      return `ADOPTION ERROR ${error.message}`
  }
}

function execute(command: Command, options: RunOptions): CheckResult {
  const git = gitIn(options)
  switch (command.kind) {
    case "list":
      return listGates(readGates(options.cwd))
    case "gate": {
      const gates = readGates(options.cwd)
      const gate = gates.find((candidate) => candidate.name === command.name)
      if (gate === undefined)
        return {
          exitCode: 2,
          lines: [`GATE ${command.name} UNKNOWN known=${gates.map((known) => known.name).join(",")}`],
        }
      return checkGate(git, gate, command.ref)
    }
    case "adoption":
      return command.row === undefined ? adoptionSummary(options.cwd, git) : adoptionRow(options.cwd, git, command.row)
  }
}

export function runGates(args: readonly string[], options: RunOptions): CheckResult {
  const command = parse(args)
  if (command === undefined) return { exitCode: 2, lines: [USAGE] }
  try {
    return execute(command, options)
  } catch (error) {
    if (!(error instanceof InputError)) throw error
    return { exitCode: 1, lines: [failureLine(command, error)] }
  }
}

if (import.meta.main) {
  const result = runGates(process.argv.slice(2), { cwd: process.cwd() })
  for (const line of result.lines) (result.exitCode === 2 && line === USAGE ? console.error : console.log)(line)
  process.exit(result.exitCode)
}
