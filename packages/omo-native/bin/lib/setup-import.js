/**
 * `omo setup`: every stage's plan is built first from the setup stream (nothing is written while
 * planning), the one summary renders them all, one consent covers the whole plan, then each stage
 * applies its part. `--ask-each` asks per stage instead; `--yes` consents; `--dry-run` prints the
 * summary and exits.
 */

import { homedir } from "node:os"
import { dirname, relative } from "node:path"
import { createInterface } from "node:readline/promises"
import { canonicalAgentDir } from "./agent-dir.js"
import { setupCoverage } from "./category-coverage.js"
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

// The directories the whole plan writes into, a directory inside another one folded into it.
function targetRoots(plans, agentDir, home) {
  const choiceDirs = plans.modelChoices.items.filter((item) => item.state === "pending").map((item) => dirname(item.target.path))
  const roots = [...new Set([agentDir, ...choiceDirs])]
  const inside = (path, root) => path !== root && !relative(root, path).startsWith("..")
  return roots.filter((path) => !roots.some((root) => inside(path, root))).map((path) => displayPath(path, home))
}

export async function runSetup(args = process.argv.slice(2), options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const agentDir = canonicalAgentDir(env, home)
  const runtime = { stdin: process.stdin, stdout: process.stdout, ...options, home, env }
  const dryRun = args.includes("--dry-run")
  // The CLI has always carried OpenCode's custom providers; the onboarding RPC leaves them opt-in.
  const { inventory, plans } = await collectSetupPlans(scanSetup(runtime, agentDir, { includeCustomProviders: true }))
  if (dryRun) process.stdout.write("DRY RUN: no files will be written\n")
  const categories = await setupCoverage({ agentDir, home, env, plans, loadRuntime: options.loadCoverageRuntime, loadEngine: options.loadCoverageEngine })
  process.stdout.write(formatSetupSummary({ home, agentDir, inventory, ...plans, categories }))
  process.stdout.write(`${TELEMETRY_NOTICE}\n`)
  if (dryRun) {
    write(setupStages(plans).filter((stage) => stage.present).flatMap((stage) => stage.lines(stage.plan)))
    return
  }
  const confirm = async (question, defaultYes) => {
    const accepted = await ask(question, { ...runtime, yes: args.includes("--yes") }, defaultYes)
    if (!accepted && runtime.stdin.isTTY === true) process.stdout.write("Import cancelled\n")
    return accepted
  }
  const pending = setupStages(plans).reduce((total, stage) => total + stage.plan.pending, 0)
  let applied = new Set()
  if (pending === 0) {
    process.stdout.write("Nothing new to import.\n")
  } else if (args.includes("--ask-each")) {
    applied = await applySetupStages(plans, (stage) => confirm(stage.question(stage.plan), false), (line) => write([line]))
  } else {
    if (!await confirm(`Import all of the above into ${targetRoots(plans, agentDir, home).join(" and ")}? [Y/n] `, true)) return
    applied = await applySetupStages(plans, () => true, (line) => write([line]))
  }
  write(setupStages(plans).filter((stage) => stage.present && (applied.has(stage.id) || stage.plan.pending === 0)).flatMap((stage) => stage.counts(stage.plan)))
}
