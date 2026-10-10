#!/usr/bin/env node

import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// GitHub counts a step skipped by its `if` as passing, so an OS leg whose test
// steps were all skipped would otherwise conclude success. This guard runs on
// every leg, after the test steps, and decides whether "no tests ran here" is
// intended (a change no test can observe) or a hole that must fail the check.

const ranOutcomes = new Set(["success", "failure", "cancelled"])

export function judgeLeg({ outcomes, os, runHeavy, fullMatrix, runtimeTouching, jobStatus }) {
  if (outcomes.some((outcome) => ranOutcomes.has(outcome))) {
    return { exitCode: 0, level: "none", message: `Tests ran on ${os}.` }
  }
  if (jobStatus !== "success") {
    return {
      exitCode: 1,
      level: "error",
      message: `tests not run on ${os}: an earlier step failed or the run was cancelled before the tests started.`,
    }
  }
  // run_heavy=false is the classifier's deliberate skip (web-only change or a
  // generated release merge, whose version bumps still touch runtime paths).
  const required = runHeavy && (runtimeTouching || os === "ubuntu-latest" || fullMatrix)
  if (required) {
    return {
      exitCode: 1,
      level: "error",
      message: `tests not run: add ci:full-matrix. This change needs the tests on ${os}, but every test step of this leg was skipped.`,
    }
  }
  const message = runHeavy
    ? `tests intentionally not run on ${os}: no runtime path changed, so only ubuntu runs the tests. Add the ci:full-matrix label to run them here.`
    : `tests intentionally not run on ${os}: the change is web or docs only, or a generated release merge, so no leg runs the heavy tests.`
  return { exitCode: 0, level: "notice", message }
}

function parseBoolean(name, value) {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`expected --${name} true|false, received ${value}`)
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error("expected --key value arguments")
    }
    values.set(key.slice(2), value)
  }
  return values
}

function required(values, name) {
  const value = values.get(name)
  if (value === undefined) throw new Error(`--${name} is required`)
  return value
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const values = parseArguments(process.argv.slice(2))
  // A missing ci-mode output arrives as an empty string; it never proves the
  // tests were optional, so it reads as "required".
  const flag = (name) => {
    const value = required(values, name)
    return value === "" ? true : parseBoolean(name, value)
  }
  const verdict = judgeLeg({
    outcomes: required(values, "outcomes").split(/\s+/).filter((outcome) => outcome.length > 0),
    os: required(values, "os"),
    runHeavy: flag("run-heavy"),
    fullMatrix: flag("full-matrix"),
    runtimeTouching: flag("runtime-touching"),
    jobStatus: required(values, "job-status"),
  })
  if (verdict.level !== "none") {
    const title = verdict.level === "error" ? "tests not run" : "tests intentionally not run"
    process.stdout.write(`::${verdict.level} title=${title}::${verdict.message}\n`)
  } else {
    process.stdout.write(`${verdict.message}\n`)
  }
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile !== undefined && summaryFile.length > 0) {
    appendFileSync(summaryFile, `## Test execution on this leg\n\n${verdict.message}\n\n`)
  }
  process.exitCode = verdict.exitCode
}
