/**
 * `omo setup`: install.setup.plan builds every stage's plan first (nothing is written while planning), the one
 * summary renders it, one consent covers the whole plan, then install.setup.apply writes it. `--ask-each` asks per
 * stage instead; `--yes` consents; `--dry-run` prints the summary and exits. Only this adapter reads the terminal.
 */

import { createInterface } from "node:readline/promises"
import { setup } from "./install-calls.js"
import { renderSetupSummary, TELEMETRY_NOTICE } from "./setup-summary.js"

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

function answered(answer) {
  if (answer.kind === "error") throw new Error(String(answer.error.details?.cause ?? answer.error.message))
  return answer.value
}

export async function runSetup(args = process.argv.slice(2), options = {}) {
  const { stdin = process.stdin, stdout = process.stdout, ...ports } = options
  const terminal = { stdin, stdout, yes: args.includes("--yes") }
  const dryRun = args.includes("--dry-run")
  const plan = answered(await setup.plan({}, ports))
  if (dryRun) process.stdout.write("DRY RUN: no files will be written\n")
  process.stdout.write(renderSetupSummary(plan.summary))
  process.stdout.write(`${TELEMETRY_NOTICE}\n`)
  if (dryRun) {
    write(plan.stages.filter((stage) => stage.present).flatMap((stage) => stage.entries.map((entry) => entry.text)))
    return
  }
  const confirm = async (question, defaultYes) => {
    const accepted = await ask(question, terminal, defaultYes)
    if (!accepted && stdin.isTTY === true) process.stdout.write("Import cancelled\n")
    return accepted
  }
  const applyPorts = { ...ports, onProgress: (event) => write([event.text]) }
  let applied
  if (plan.pending === 0) {
    process.stdout.write("Nothing new to import.\n")
    applied = await setup.apply({ plan, consent: "all" }, applyPorts)
  } else if (args.includes("--ask-each")) {
    applied = await setup.apply(
      {
        plan,
        consent: "each",
        decide: async (stage) => ((await confirm(stage.description, false)) ? "apply" : "skip"),
      },
      applyPorts,
    )
  } else {
    if (!(await confirm(`Import all of the above into ${plan.target_roots.join(" and ")}? [Y/n] `, true))) return
    applied = await setup.apply({ plan, consent: "all" }, applyPorts)
  }
  write(answered(applied).stages.flatMap((stage) => stage.entries.map((entry) => entry.text)))
}
