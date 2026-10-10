/**
 * `omo setup`: every stage's plan is built first (nothing is written while planning), the one
 * summary renders them all, one consent covers the whole plan, then each stage applies its part.
 * `--ask-each` asks per stage instead; `--yes` consents; `--dry-run` prints the summary and exits.
 */

import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { createInterface } from "node:readline/promises"
import { canonicalAgentDir } from "./agent-dir.js"
import { setupCoverage } from "./category-coverage.js"
import { detectHarnesses } from "./setup-detect.js"
import { applyCredentials, credentialCounts, credentialPlanLines, credentialQuestion, opencodeOauthProviders, planCredentials } from "./setup-credentials.js"
import { applyAssets, assetCounts, assetPlanLines, assetQuestion, planAssets } from "./setup-assets-import.js"
import { planOpencodeProviders } from "./setup-opencode-providers.js"
import { applyProviders, planProviders, providerCounts, providerPlanLines, providerQuestion } from "./setup-providers-import.js"
import { applyModelChoices, modelChoiceCounts, modelChoicePlanLines, modelChoiceQuestion, planModelChoices } from "./setup-model-choices-import.js"
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

// In apply order: the model-choice stage runs last because a default model or category may name a
// custom provider the stage before it carries. `present` stages report counts after the run.
function stageList(plans) {
  return [
    { plan: plans.credentials, present: !plans.credentials.malformed, lines: credentialPlanLines, counts: credentialCounts, question: credentialQuestion, apply: applyCredentials },
    { plan: plans.assets, present: plans.assets.present, lines: assetPlanLines, counts: assetCounts, question: assetQuestion, apply: applyAssets },
    { plan: plans.providers, present: plans.providers.present, lines: providerPlanLines, counts: providerCounts, question: providerQuestion, apply: applyProviders },
    { plan: plans.modelChoices, present: plans.modelChoices.present, lines: modelChoicePlanLines, counts: modelChoiceCounts, question: modelChoiceQuestion, apply: applyModelChoices },
  ]
}

// The directories the whole plan writes into, a directory inside another one folded into it.
function targetRoots(plans, agentDir, home) {
  const choiceDirs = plans.modelChoices.items.filter((item) => item.state === "pending").map((item) => dirname(item.target.path))
  const roots = [...new Set([agentDir, ...choiceDirs])]
  const inside = (path, root) => path !== root && !relative(root, path).startsWith("..")
  return roots.filter((path) => !roots.some((root) => inside(path, root))).map((path) => displayPath(path, home))
}

async function planAll(runtime, agentDir) {
  const providerSource = planOpencodeProviders(runtime)
  const credentials = await planCredentials(runtime, join(agentDir, "auth.json"), new Set(providerSource.providers.map((item) => item.id)))
  const assets = planAssets({ runtime, agentDir })
  const providers = planProviders(providerSource, agentDir)
  const oauthProviders = opencodeOauthProviders(runtime)
  const planChoices = (customProviders) => planModelChoices({ runtime, agentDir, customProviders, oauthProviders })
  return { credentials, assets, providers, modelChoices: await planChoices(providers.result.added), planChoices }
}

// Per-stage consent. A declined provider stage leaves models.json as it is, so the model choices
// are re-planned against it rather than against providers that will not exist.
async function applyEach(plans, confirm) {
  const applied = new Set()
  for (const [index, stage] of stageList(plans).entries()) {
    if (index === 3 && plans.providers.pending > 0 && !applied.has(2)) {
      const shown = new Set(plans.modelChoices.notices)
      plans.modelChoices = await plans.planChoices([])
      stage.plan = plans.modelChoices
      write(plans.modelChoices.notices.filter((notice) => !shown.has(notice)))
    }
    if (stage.plan.pending === 0) continue
    if (!await confirm(stage.question(stage.plan), false)) continue
    stage.apply(stage.plan)
    applied.add(index)
  }
  return applied
}

export async function runSetup(args = process.argv.slice(2), options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const agentDir = canonicalAgentDir(env, home)
  const runtime = { stdin: process.stdin, stdout: process.stdout, ...options, home, env }
  const dryRun = args.includes("--dry-run")
  const inventory = await detectHarnesses(runtime)
  const plans = await planAll(runtime, agentDir)
  if (dryRun) process.stdout.write("DRY RUN: no files will be written\n")
  const categories = await setupCoverage({ agentDir, home, env, plans, loadRuntime: options.loadCoverageRuntime, loadEngine: options.loadCoverageEngine })
  process.stdout.write(formatSetupSummary({ home, agentDir, inventory, ...plans, categories }))
  process.stdout.write(`${TELEMETRY_NOTICE}\n`)
  if (dryRun) {
    write(stageList(plans).filter((stage) => stage.present).flatMap((stage) => stage.lines(stage.plan)))
    return
  }
  const confirm = async (question, defaultYes) => {
    const accepted = await ask(question, { ...runtime, yes: args.includes("--yes") }, defaultYes)
    if (!accepted && runtime.stdin.isTTY === true) process.stdout.write("Import cancelled\n")
    return accepted
  }
  const pending = stageList(plans).reduce((total, stage) => total + stage.plan.pending, 0)
  let applied = new Set()
  if (pending === 0) {
    process.stdout.write("Nothing new to import.\n")
  } else if (args.includes("--ask-each")) {
    applied = await applyEach(plans, confirm)
  } else {
    if (!await confirm(`Import all of the above into ${targetRoots(plans, agentDir, home).join(" and ")}? [Y/n] `, true)) return
    for (const [index, stage] of stageList(plans).entries()) {
      if (stage.plan.pending === 0) continue
      stage.apply(stage.plan)
      applied.add(index)
    }
  }
  write(stageList(plans).filter((stage, index) => stage.present && (applied.has(index) || stage.plan.pending === 0)).flatMap((stage) => stage.counts(stage.plan)))
}
