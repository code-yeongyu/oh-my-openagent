#!/usr/bin/env node
// Audits a ulw-plan work plan against its evidence ledger: every top-level checkbox must be checked
// and every checked task must have at least one ledger entry naming it. Used as the final gate for
// the agent-toolkit SDK plan, but it takes any plan/ledger pair.
import { readFileSync, existsSync } from "node:fs"

function parseArgs(argv) {
  let plan
  let ledger
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--plan") plan = argv[index + 1]
    if (argv[index] === "--ledger") ledger = argv[index + 1]
  }
  return { plan, ledger }
}

function checkboxes(planText) {
  const rows = []
  for (const line of planText.split("\n")) {
    const match = /^- \[( |x)\] (\d+)\. (.+)$/.exec(line)
    if (match !== null) rows.push({ done: match[1] === "x", number: Number(match[2]), title: match[3] })
  }
  return rows
}

function ledgerEntries(ledgerText) {
  const entries = []
  for (const line of ledgerText.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // A malformed audit line is itself a finding, but it must not stop the audit.
      entries.push({ raw: line })
    }
  }
  return entries
}

const { plan, ledger } = parseArgs(process.argv.slice(2))
if (plan === undefined || ledger === undefined) {
  console.error("usage: agent-toolkit-sdk-plan-audit.mjs --plan <plan.md> --ledger <ledger.jsonl>")
  process.exit(2)
}
if (!existsSync(plan) || !existsSync(ledger)) {
  console.error(`agent-toolkit-sdk-plan-audit: missing plan or ledger (${plan}, ${ledger})`)
  process.exit(2)
}

const rows = checkboxes(readFileSync(plan, "utf8"))
const entries = ledgerEntries(readFileSync(ledger, "utf8"))
const entryText = entries.map((entry) => JSON.stringify(entry)).join("\n")

const unchecked = rows.filter((row) => !row.done).map((row) => row.number)
const uncovered = rows
  .filter((row) => row.done)
  .filter((row) => !new RegExp(`"task":\\s*${row.number}\\b`).test(entryText))
  .map((row) => row.number)

console.log(`plan rows: ${rows.length}; checked: ${rows.length - unchecked.length}; ledger entries: ${entries.length}`)
if (unchecked.length > 0) console.error(`unchecked tasks: ${unchecked.join(", ")}`)
if (uncovered.length > 0) console.error(`checked tasks with no ledger evidence: ${uncovered.join(", ")}`)
process.exit(unchecked.length === 0 && uncovered.length === 0 ? 0 : 1)
