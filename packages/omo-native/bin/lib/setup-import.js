/**
 * `omo setup`: every stage's plan is built first from the setup stream (nothing is written while
 * planning), the one summary renders them all, one consent covers the whole plan, then each stage
 * applies its part. `--ask-each` asks per stage instead; `--yes` consents; `--dry-run` prints the
 * summary and exits.
 *
 * PR-D splits the interactive consent layer so MCP servers and custom providers each get their
 * own `Y/n` prompt with provenance (URL / file refs / key source). Credentials and model choices
 * are not "servers" and continue to flow through the existing per-stage apply path without a
 * separate prompt — the opt-out config and `--yes` short-circuit the per-server round-trip.
 * `--yes` preserves the legacy single-batch consent for script callers.
 */

import { homedir } from "node:os"
import { createInterface } from "node:readline/promises"
import { canonicalAgentDir } from "./agent-dir.js"
import { setupCoverage } from "./category-coverage.js"
import {
  buildPerServerConsent,
  filterPlansByConsent,
  loadSetupOptOut,
  perServerConsentPrompt,
  resolvePerServerConsent,
} from "./setup-per-server.js"
import { applySetupStages, collectSetupPlans, scanSetup, setupStages } from "./setup-stream.js"
import { displayPath, formatSetupSummary, TELEMETRY_NOTICE } from "./setup-summary.js"

function write(lines) {
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`)
}

async function ask(question, options, defaultYes) {
  if (options.yes) return true
  if (options.stdin?.isTTY !== true || options.stdout?.isTTY !== true) {
    process.stdout.write("Non-interactive setup did not import. Re-run with `omo setup --yes`.\n")
    return false
  }
  process.stdout.write(question)
  const readline = createInterface({ input: options.stdin, output: options.stdout })
  try {
    const answer = (await readline.question("")).trim().toLowerCase()
    return answer === "y" || answer === "yes" || (defaultYes && answer === "")
  } finally {
    readline.close()
  }
}

// Per-server prompt: same `Y/n` as the stage-level ask, but rendered against the row's
// provenance (name, kind, url, file refs, key source). Default-Y to match the spec example
// `Import? [Y/n]`.
async function askOneServer(row, runtime) {
  return ask(perServerConsentPrompt(row), runtime, true)
}

export async function runSetup(args = process.argv.slice(2), options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const agentDir = canonicalAgentDir(env, home)
  const runtime = { stdin: process.stdin, stdout: process.stdout, ...options, home, env }
  const dryRun = args.includes("--dry-run")
  const yes = args.includes("--yes")
  // The CLI has always carried OpenCode's custom providers; the onboarding RPC leaves them opt-in.
  const { inventory, plans } = await collectSetupPlans(scanSetup(runtime, agentDir, { includeCustomProviders: true }))
  if (dryRun) process.stdout.write("DRY RUN: no files will be written\n")
  const categories = await setupCoverage({ agentDir, home, env, plans, loadRuntime: options.loadCoverageRuntime, loadEngine: options.loadCoverageEngine })
  process.stdout.write(formatSetupSummary({ home, agentDir, inventory, ...plans, categories }))
  process.stdout.write(`${TELEMETRY_NOTICE}\n`)
  // The dry-run path lists every server with full provenance (URL/kind/file-origins/key chains)
  // and writes nothing. `--dry-run` always wins over `--yes` and over the consent layer.
  if (dryRun) {
    const optOut = await loadSetupOptOut({ home, env })
    const rows = buildPerServerConsent(plans, { optOut })
    write(rows.map((row) => perServerConsentPrompt(row)))
    write(setupStages(plans).filter((stage) => stage.present).flatMap((stage) => stage.lines(stage.plan)))
    return
  }
  const pending = setupStages(plans).reduce((total, stage) => total + stage.plan.pending, 0)
  let applied = new Set()
  if (pending === 0) {
    process.stdout.write("Nothing new to import.\n")
    write(setupStages(plans).filter((stage) => stage.present).flatMap((stage) => stage.counts(stage.plan)))
    return
  }
  // PR-D per-server consent: every server (MCP server, custom provider) gets its own `Y/n`
  // unless the user opted out via config (`setup.opt_out.*`), `--yes` (batch accept), or
  // `--ask-each` (legacy per-stage path). Credentials and model choices are not servers; they
  // run regardless because PR-D's scope is the server boundary, not every consent UI.
  const optOut = await loadSetupOptOut({ home, env })
  const rows = buildPerServerConsent(plans, { optOut })
  const askRuntime = { ...runtime, yes }
  const acceptAll = () => new Map(rows.map((row) => [row.id, true]))
  let filtered = plans
  if (args.includes("--ask-each")) {
    // --ask-each is a legacy script path: per-stage confirm instead of per-server, opt-out or not.
    // Existing scripts that route through stage questions see no behavior change.
    filtered = plans
  } else if (rows.length > 0) {
    const decisions = yes
      ? acceptAll()
      : await resolvePerServerConsent(rows, (row) => askOneServer(row, askRuntime))
    const anyAccepted = [...decisions.values()].some((accepted) => accepted === true)
    if (!anyAccepted) {
      process.stdout.write(`Import cancelled: 0 of ${rows.length} server(s) accepted\n`)
      return
    }
    filtered = filterPlansByConsent(plans, decisions)
  }
  if (args.includes("--ask-each")) {
    const confirm = async (question, defaultYes) => {
      const accepted = await ask(question, askRuntime, defaultYes)
      if (!accepted && runtime.stdin?.isTTY === true) process.stdout.write("Import cancelled\n")
      return accepted
    }
    applied = await applySetupStages(filtered, (stage) => confirm(stage.question(stage.plan), false), (line) => write([line]))
  } else {
    applied = await applySetupStages(filtered, () => true, (line) => write([line]))
  }
  write(setupStages(filtered).filter((stage) => stage.present && (applied.has(stage.id) || stage.plan.pending === 0)).flatMap((stage) => stage.counts(stage.plan)))
}
