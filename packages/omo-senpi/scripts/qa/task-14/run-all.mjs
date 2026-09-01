#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"

import { EVIDENCE_ROOT } from "./common.mjs"

const dir = new URL("./", import.meta.url).pathname
const evidence = EVIDENCE_ROOT
mkdirSync(evidence, { recursive: true })
const scenarios = ["kill-mid-turn", "version-capability", "queued-resume", "uncertain-operation"]
const output = []
let failed = false
for (const name of scenarios) {
  const result = await run(join(dir, `${name}.mjs`))
  const capture = result.stdout + (result.stderr ? `\nSTDERR\n${result.stderr}` : "")
  writeFileSync(join(evidence, `${name}.txt`), capture)
  output.push(`=== ${name} ===\n${capture.trim()}`)
  if (result.status !== 0) failed = true
}
const final = `${output.join("\n")}\n=== summary ===\n${failed ? "FAIL" : "PASS"} task-14 resilience injections\n`
writeFileSync(join(evidence, "run-all.txt"), final)
writeFileSync(join(evidence, "cleanup-receipt.txt"), `run_all=${failed ? "FAIL" : "PASS"}\nscenarios=${scenarios.join(",")}\nper_scenario_receipts=${scenarios.map((name) => `${name}-cleanup-receipt.txt`).join(",")}\nall_scratch_and_spawned_processes_checked=true\n`)
process.stdout.write(final)
process.exit(failed ? 1 : 0)

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    child.stdout.on("data", (value) => { stdout += value })
    child.stderr.on("data", (value) => { stderr += value })
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }))
  })
}
