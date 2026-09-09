#!/usr/bin/env bun
// Live RPC proof of kibitzer tool-boundary delivery: S3 mid-turn steer, S4 turn-tail
// next-prompt, S5 idle never wakes, S6 long-command argument harvesting. Verdicts are JSONL entries + mock request counts.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { parseArgs } from "./kibitzer-e2e-support.mjs"
import { runS3, runS4, runS5, runS6 } from "./kibitzer-tool-boundary-e2e-scenarios.mjs"

const RUNNERS = { s3: runS3, s4: runS4, s5: runS5, s6: runS6 }

function writeEvidence(dir, name, body) {
  writeFileSync(join(dir, name), typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`)
}

function readmeFor(payload) {
  const lines = [
    "# kibitzer tool-boundary live RPC",
    "",
    "## What was tested",
    "S3 mid-turn steer after the first tool result, S4 turn-tail with no extra parent round and next-prompt delivery, S5 idle never wakes (assertUnchangedFor 5s), S6 a single-word filename the seed describes only in a long tool argument launches the judge and delivers mid-turn (eval fallback because the sandbox parent has no bash tool).",
    "",
    "## Observed",
    `- ok: ${payload.ok}`,
    `- S3: ${payload.scenarios.s3?.result ?? "skipped"} parentRequests=${payload.scenarios.s3?.parentRequests}`,
    `- S4: ${payload.scenarios.s4?.result ?? "skipped"} parentRequests=${payload.scenarios.s4?.parentRequests}`,
    `- S5: ${payload.scenarios.s5?.result ?? "skipped"} parentRequestsBefore=${payload.scenarios.s5?.parentRequestsBefore} parentRequestsAfter=${payload.scenarios.s5?.parentRequestsAfter}`,
    `- S6: ${payload.scenarios.s6?.result ?? "skipped"} parentRequests=${payload.scenarios.s6?.parentRequests} tool=${payload.scenarios.s6?.tool} argumentLength=${payload.scenarios.s6?.argumentLength}`,
    `- realSenpiUntouched: s3=${payload.scenarios.s3?.realSenpiUntouched} s4=${payload.scenarios.s4?.realSenpiUntouched} s5=${payload.scenarios.s5?.realSenpiUntouched} s6=${payload.scenarios.s6?.realSenpiUntouched}`,
    "",
    "## Why it is enough",
    "Assertions read parent session JSONL custom_message/custom entries and the mock server's parent/judge request counts. Stdout text is never treated as proof.",
    "",
    "## What was omitted",
    "No live network provider. Judge and parent both hit 127.0.0.1. Real ~/.senpi and ~/.omo are digested, not used as the agent dir.",
    "",
  ]
  return `${lines.join("\n")}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2), ["s3", "s4", "s5", "s6"])
  if (!existsSync(options.senpiCli)) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-cli-missing", senpiCli: options.senpiCli }, null, 2))
    process.exit(0)
  }
  if (!existsSync(join(options.pluginRoot, "extensions"))) {
    throw new Error(`plugin bundle not built at ${options.pluginRoot}/extensions`)
  }
  console.log(`plugin-root: ${options.pluginRoot}`)
  console.log(`senpi-cli: ${options.senpiCli}`)
  console.log(`scenario: ${options.scenario}`)

  const kinds = options.scenario === "all" ? ["s3", "s4", "s5", "s6"] : [options.scenario]
  const checks = []
  const scenarios = {}
  const evidenceDir = options.evidenceDir
  if (evidenceDir !== undefined) mkdirSync(evidenceDir, { recursive: true })
  const requestLogPath = evidenceDir === undefined ? undefined : join(evidenceDir, "mock-requests.jsonl")
  if (requestLogPath !== undefined) writeFileSync(requestLogPath, "")

  for (const kind of kinds) {
    let facts
    try {
      facts = await RUNNERS[kind](options, checks, requestLogPath)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      checks.push({ name: `${kind}.uncaught`, ok: false, detail })
      console.log(`FAIL ${kind}.uncaught :: ${detail}`)
      facts = { result: "FAIL", error: detail, counts: {}, sessionText: "" }
    }
    const counts = facts.counts ?? {}
    scenarios[kind] = { result: facts.result, ...counts, realSenpiUntouched: facts.realSenpiUntouched === true }
    if (evidenceDir !== undefined && typeof facts.sessionText === "string") {
      writeEvidence(evidenceDir, `${kind}-session.jsonl`, facts.sessionText.endsWith("\n") ? facts.sessionText : `${facts.sessionText}\n`)
    }
  }

  const failures = checks.filter((check) => !check.ok)
  const payload = {
    ok: failures.length === 0 && kinds.every((kind) => scenarios[kind]?.result === "PASS"),
    scenarios,
    checks,
  }
  if (evidenceDir !== undefined) {
    writeEvidence(evidenceDir, "driver-result.json", payload)
    writeEvidence(evidenceDir, "README.md", readmeFor(payload))
    console.log(`evidence: ${evidenceDir}`)
  }
  console.log(JSON.stringify({
    ok: payload.ok,
    S3: scenarios.s3?.result ?? "skipped",
    S4: scenarios.s4?.result ?? "skipped",
    S5: scenarios.s5?.result ?? "skipped",
    S6: scenarios.s6?.result ?? "skipped",
    total: checks.length,
    failures: failures.map((check) => check.name),
    scenarios,
  }, null, 2))
  process.exit(payload.ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
