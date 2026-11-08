#!/usr/bin/env bun
// Loop driver for omo #10177: runs the two-process SIGKILL-takeover case (or the in-commit-kill
// variant) N times against fresh fixture repos, checking `git fsck --full --strict` after the
// takeover and after the follow-up commits, and reports the missing/corrupt-object failure rate.
// The iteration protocols live in ./loop-harness.mjs.
//
// Usage:
//   bun packages/memory-core/src/concurrency/loop-crash-consistency.mjs \
//       --case sigkill --iterations 200 --load 8 [--keep-failures 5]
//
// --case sigkill    writer-child.ts kill-holder + recovery, exactly the CI case (default)
// --case in-commit  crash-commit-child.ts kill-mid-commit + peer: SIGKILL lands inside `git commit`
// --load N          run N copies of `yes >/dev/null` during the loop, killed at the end
// --keep-failures N keep at most N failed fixture roots for forensics (default 5)
//
// Exit code 0 when every iteration passed, 1 otherwise. Failure lines are JSON on stdout.

import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"

import {
  expectedRange,
  fixture,
  inCommitIteration,
  sigkillIteration,
} from "./loop-harness.mjs"

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const iterations = Number.parseInt(arg("iterations", "200"), 10)
const loadWorkers = Number.parseInt(arg("load", "0"), 10)
const caseName = arg("case", "sigkill")
const keepFailures = Number.parseInt(arg("keep-failures", "5"))

if (!Number.isInteger(iterations) || iterations < 1) throw new Error("invalid --iterations")
if (caseName !== "sigkill" && caseName !== "in-commit") throw new Error("invalid --case")

const loaders = []
for (let index = 0; index < loadWorkers; index += 1) {
  loaders.push(spawn("yes", [], { stdio: ["ignore", "ignore", "ignore"] }))
}

const started = Date.now()
const failures = []
const kept = []
let danglingTotal = 0
try {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const fix = await fixture()
    let failure = null
    try {
      const result = caseName === "sigkill" ? await sigkillIteration(fix) : await inCommitIteration(fix)
      const { min, max } = expectedRange(caseName)
      const badCheck = result.checks.find((check) => !check.ok)
      danglingTotal += result.checks.reduce((sum, check) => sum + check.dangling, 0)
      if (badCheck) {
        failure = { iteration, stage: badCheck.stage, broken: badCheck.broken, fsckExit: badCheck.exitCode, report: badCheck.report }
      } else if (result.commitCount < min || result.commitCount > max || result.mergeCount !== 0) {
        failure = { iteration, stage: "commit-shape", commitCount: result.commitCount, expected: `${min}..${max}`, mergeCount: result.mergeCount }
      }
    } catch (error) {
      failure = { iteration, stage: "driver", message: String(error && error.message ? error.message : error).slice(0, 600) }
    }
    if (failure) {
      failures.push(failure)
      console.log(`FAIL ${JSON.stringify(failure)}`)
      if (kept.length < keepFailures) {
        kept.push(fix.root)
      } else {
        await rm(fix.root, { recursive: true, force: true })
      }
    } else {
      await rm(fix.root, { recursive: true, force: true })
    }
    if (iteration % 10 === 0 || iteration === iterations) {
      console.log(`progress ${iteration}/${iterations} failures=${failures.length}`)
    }
  }
} finally {
  for (const loader of loaders) loader.kill("SIGKILL")
}

const elapsedSec = ((Date.now() - started) / 1000).toFixed(1)
const rate = `${failures.length}/${iterations} (${((failures.length / iterations) * 100).toFixed(2)}%)`
console.log(`SUMMARY case=${caseName} iterations=${iterations} failures=${failures.length} rate=${rate} dangling-total=${danglingTotal} load=${loadWorkers} elapsed=${elapsedSec}s`)
if (kept.length > 0) console.log(`kept failure fixtures: ${kept.join(", ")}`)
process.exit(failures.length === 0 ? 0 : 1)
