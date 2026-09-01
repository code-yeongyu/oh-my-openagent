#!/usr/bin/env node
// expect-exit.mjs — run a command and assert its exit code matches the expected value
// Usage: node expect-exit.mjs <expected-exit-code> -- <command...>
// Exits 0 if the command's exit code matches, 1 otherwise.

import { spawn } from "node:child_process"

const expectedCode = Number(process.argv[2])
const sepIdx = process.argv.indexOf("--")
if (Number.isNaN(expectedCode) || sepIdx < 0 || sepIdx + 1 >= process.argv.length) {
  console.error("Usage: node expect-exit.mjs <expected-exit-code> -- <command...>")
  process.exit(1)
}

const cmd = process.argv[sepIdx + 1]
const args = process.argv.slice(sepIdx + 2)

const child = spawn(cmd, args, { stdio: "inherit" })
child.on("exit", (code) => {
  const actual = code ?? 1
  if (actual === expectedCode) {
    console.log(`expect-exit: exit code ${actual} matches expected ${expectedCode}`)
    process.exit(0)
  } else {
    console.error(`expect-exit: exit code ${actual} does NOT match expected ${expectedCode}`)
    process.exit(1)
  }
})
child.on("error", (err) => {
  console.error(`expect-exit: spawn error: ${err.message}`)
  process.exit(1)
})
