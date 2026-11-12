#!/usr/bin/env bun
// The Windows live tier (computer-live-windows-full.yml): turns the hosted probe's facts into the ledger
// crates/omo-computer-backend-win32/probes/hosted-windows-live.tsv, plans which tier carries each leg, runs a tier's
// legs and watches for the guest runner.
//   --ledger <facts.jsonl>... --out <tsv> --host <label> [--measured-at <iso>]
//   --validate <tsv>
//   --plan <tsv> --guest on|off [--out <plan.json>]
//   --run --tier hosted|guest --plan <plan.json> [--driver <path>]
//   --watch-guest --job <name> --deadline-s <n>   (GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT)
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import {
  decideTier,
  decideWatch,
  guestJobState,
  LEGS,
  type LegId,
  ledgerRows,
  ledgerTsv,
  ledgerVerdicts,
  parseFacts,
  type PlannedLeg,
  planLegs,
  planLine,
  scenarioBuilt,
  setLine,
  validateLedger,
} from "./windows-full-ledger.ts"

const DEFAULT_DRIVER = "script/qa/computer/windows.ts"
const WATCH_INTERVAL_MS = 30_000

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

function readPlan(path: string): readonly PlannedLeg[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!Array.isArray(raw)) throw new Error(`${path} is not a plan array`)
  const legs: LegId[] = LEGS.map((l) => l.leg)
  return raw.flatMap((entry: unknown): PlannedLeg[] => {
    if (typeof entry !== "object" || entry === null) return []
    const leg = legs.find((l) => l === Reflect.get(entry, "leg"))
    const tier = Reflect.get(entry, "tier")
    if (!leg) return []
    if (tier === "hosted" || tier === "guest") return [{ leg, tier }]
    return tier === "blocked" ? [{ leg, tier, reason: "no_windows_host" }] : []
  })
}

async function runScenario(driver: string, scenario: string): Promise<boolean> {
  const proc = Bun.spawn(["bun", driver, "--scenario", scenario, "--json"], { stdout: "pipe", stderr: "inherit" })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const last = out
    .trim()
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("{"))
  console.log(`scenario ${scenario}: ${last ?? "no JSON line"}`)
  return proc.exitCode === 0 && last !== undefined && /"verdict"\s*:\s*"PASS"/.test(last)
}

async function run(args: readonly string[]): Promise<number> {
  const tier = required(args, "--tier")
  if (tier !== "hosted" && tier !== "guest") throw new Error("--tier takes hosted or guest")
  const driver = flag(args, "--driver") ?? DEFAULT_DRIVER
  const source = existsSync(driver) ? readFileSync(driver, "utf8") : null
  const counts = { pass: 0, fail: 0, blocked: 0, notBuilt: 0 }
  for (const p of readPlan(required(args, "--plan"))) {
    if (p.tier !== tier) continue
    const scenario = LEGS.find((l) => l.leg === p.leg)?.scenario ?? p.leg
    if (!scenarioBuilt(source, scenario)) {
      console.log(`leg=${p.leg} tier=${tier} scenario=${scenario} blocked reason=backend_not_built`)
      counts.blocked += 1
      counts.notBuilt += 1
      continue
    }
    if (await runScenario(driver, scenario)) counts.pass += 1
    else counts.fail += 1
  }
  console.log(setLine(tier, counts))
  return counts.fail === 0 ? 0 : 1
}

async function listJobs(): Promise<readonly { readonly name: string; readonly status: string }[]> {
  const env = (k: string) => {
    const v = process.env[k]
    if (!v) throw new Error(`${k} is not set`)
    return v
  }
  const url = `https://api.github.com/repos/${env("GITHUB_REPOSITORY")}/actions/runs/${env("GITHUB_RUN_ID")}/attempts/${env("GITHUB_RUN_ATTEMPT")}/jobs?per_page=100`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${env("GITHUB_TOKEN")}`, accept: "application/vnd.github+json" },
  })
  if (!res.ok) throw new Error(`jobs read failed: HTTP ${res.status}`)
  const body: unknown = await res.json()
  const jobs: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "jobs") : null
  if (!Array.isArray(jobs)) throw new Error("jobs read returned no jobs array")
  return jobs.map((j: unknown) => ({
    name: String(Reflect.get(Object(j), "name")),
    status: String(Reflect.get(Object(j), "status")),
  }))
}

async function watchGuest(args: readonly string[]): Promise<number> {
  const job = required(args, "--job")
  const deadline = Number(required(args, "--deadline-s"))
  const started = Date.now()
  for (;;) {
    const elapsed = Math.floor((Date.now() - started) / 1000)
    const state = guestJobState(await listJobs(), job)
    const decision = decideWatch(state, elapsed, deadline)
    console.log(`watch job="${job}" state=${state} elapsed=${elapsed}s deadline=${deadline}s -> ${decision}`)
    if (decision === "ok") return 0
    if (decision === "runner_unavailable") {
      console.log(`runner_unavailable: the guest job "${job}" did not start within ${deadline}s`)
      return 1
    }
    await Bun.sleep(WATCH_INTERVAL_MS)
  }
}

async function main(args: readonly string[]): Promise<number> {
  if (args.includes("--ledger")) return ledger(args)
  if (args.includes("--validate")) return validate(args)
  if (args.includes("--run")) return run(args)
  if (args.includes("--plan")) return plan(args)
  if (args.includes("--watch-guest")) return watchGuest(args)
  console.error("usage: windows-full.ts --ledger|--validate|--plan|--run|--watch-guest (see the header)")
  return 2
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
