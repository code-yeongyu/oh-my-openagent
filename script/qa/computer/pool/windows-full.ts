#!/usr/bin/env bun
// The Windows live tier (computer-live-windows-full.yml): turns the hosted probe's facts into the ledger
// crates/omo-computer-backend-win32/probes/hosted-windows-live.tsv and plans which tier would carry each leg.
//   --ledger <facts.jsonl>... --out <tsv> --host <label> [--measured-at <iso>]
//   --validate <tsv>
//   --plan <tsv> --guest on|off [--out <plan.json>]
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import {
  decideTier,
  LEGS,
  ledgerRows,
  ledgerTsv,
  ledgerVerdicts,
  parseFacts,
  planLegs,
  planLine,
  validateLedger,
} from "./windows-full-ledger.ts"

function flag(args: readonly string[], name: string): string | null {
  const i = args.indexOf(name)
  const v = i >= 0 ? args[i + 1] : undefined
  return v !== undefined && !v.startsWith("--") ? v : null
}

function required(args: readonly string[], name: string): string {
  const v = flag(args, name)
  if (v === null) throw new Error(`${name} <value> is required`)
  return v
}

function positional(args: readonly string[], after: string): readonly string[] {
  const out: string[] = []
  for (const a of args.slice(args.indexOf(after) + 1)) {
    if (a.startsWith("--")) break
    out.push(a)
  }
  return out
}

function ledger(args: readonly string[]): number {
  const files = positional(args, "--ledger")
  if (files.length === 0) throw new Error("--ledger needs at least one facts file")
  const parsed = files.map((f) => parseFacts(existsSync(f) ? readFileSync(f, "utf8") : ""))
  const missing = files.filter((f) => !existsSync(f))
  for (const f of missing) console.log(`facts file absent: ${f} (its legs read UNMEASURED)`)
  const rejected = parsed.reduce((n, p) => n + p.rejected, 0)
  if (rejected > 0) console.log(`facts lines rejected: ${rejected}`)
  const rows = ledgerRows(
    parsed.flatMap((p) => p.facts),
    { host: required(args, "--host"), measuredAt: flag(args, "--measured-at") ?? new Date().toISOString() },
  )
  writeFileSync(required(args, "--out"), ledgerTsv(rows))
  for (const r of rows) console.log(`LEDGER leg=${r.leg} verdict=${r.verdict} evidence=${r.evidence}`)
  return 0
}

function validate(args: readonly string[]): number {
  const path = required(args, "--validate")
  const errors = validateLedger(readFileSync(path, "utf8"))
  for (const e of errors) console.log(`LEDGER invalid: ${e}`)
  if (errors.length === 0) console.log(`LEDGER valid rows=${LEGS.length} file=${path}`)
  return errors.length === 0 ? 0 : 1
}

function plan(args: readonly string[]): number {
  const guest = required(args, "--guest")
  if (guest !== "on" && guest !== "off") throw new Error("--guest takes on or off")
  const legs = planLegs(ledgerVerdicts(readFileSync(required(args, "--plan"), "utf8")), guest === "on")
  for (const p of legs) console.log(planLine(p))
  console.log(`WINDOWS_FULL_TIER=${decideTier(legs)}`)
  const out = flag(args, "--out")
  if (out !== null) writeFileSync(out, `${JSON.stringify(legs)}\n`)
  return 0
}

function main(args: readonly string[]): number {
  if (args.includes("--ledger")) return ledger(args)
  if (args.includes("--validate")) return validate(args)
  if (args.includes("--plan")) return plan(args)
  console.error("usage: windows-full.ts --ledger|--validate|--plan (see the header)")
  return 2
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
