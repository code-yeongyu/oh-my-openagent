#!/usr/bin/env node
import { loadOmowright } from "./omowright.mjs"

const json = process.argv.includes("--json")
const waitArg = process.argv.find((arg) => arg.startsWith("--wait-ms="))
const waitTotalMs = waitArg ? Number(waitArg.slice("--wait-ms=".length)) : 0
const browserArg = process.argv.find((arg) => arg.startsWith("--browser="))
const browser = browserArg ? browserArg.slice("--browser=".length) : undefined

const { omowright } = await loadOmowright()
const steps = []
const result = await omowright.bskOnboard({
  browser,
  onHumanStep: (step) => steps.push(step),
  waitForBrowserMs: waitTotalMs > 0 ? Math.min(15_000, waitTotalMs) : 0,
  waitTotalMs,
})

// A down daemon cannot see the extension, so it is no reason to ask the user to enable it.
// That includes a failed CLI install: no CLI, no daemon.
const daemonDown = !result.ready && !result.needsChoice && !result.daemon.running
// An omowright with its PR #70 sets daemon.startBlocked. Older omowright only reports the refusal in the error text:
// bsk's own "Job Object" message, or its Windows fallback when registering the daemon's scheduled task fails.
const startBlocked = daemonDown && (result.daemon.startBlocked ?? /Job Object|breakaway|registering the bsk daemon task/i.test(result.daemon.error ?? ""))
const FOREGROUND_STEP = "run `bsk daemon start --foreground` in a persistent background session that outlives the command, then check `bsk status` from a separate call."
const DAEMON_STEP = !result.cli.installed
  ? "Install the bsk CLI first: the official installer did not leave a working `bsk`; re-run this script, and if it fails again follow references/install.md to install it by hand."
  : startBlocked
  ? `Start the daemon in the foreground: this host does not let a command detach it, so retrying \`bsk status\` or \`bsk daemon start\` fails the same way; ${FOREGROUND_STEP}`
  : `Start the daemon first: run \`bsk status\` once; if the host forbids Job Object breakaway (Windows) or reaps background processes, ${FOREGROUND_STEP}`
// An omowright with its PR #69 returns nextStep; older omowright has none, so derive it from the result.
const nextStep = result.ready ? null : daemonDown ? DAEMON_STEP : result.nextStep ?? result.humanStep ?? null

const summary = {
  ready: result.ready,
  cli: result.cli,
  installerRan: result.install !== null,
  daemon: { running: result.daemon.running, version: result.daemon.version ?? null, error: result.daemon.error ?? null, startBlocked },
  browser: result.primary ? { id: result.primary.id, label: result.primary.label, confidence: result.identification.confidence, reason: result.identification.reason } : null,
  needsChoice: result.needsChoice,
  candidates: result.identification.candidates.map((c) => ({ id: c.id, label: c.label, signals: c.signals })),
  registeredElsewhere: result.identification.registeredElsewhere,
  registrations: result.registrations.map((r) => ({ browser: r.browser, registered: r.registered, alreadyPresent: r.alreadyPresent ?? false, reason: r.reason ?? null, needsRestart: r.needsRestart ?? null, humanStep: daemonDown ? null : r.humanStep ?? null })),
  browsersConnected: result.browsersConnected.map((b) => ({ instanceId: b.instance_id, name: b.browser_name, version: b.browser_version })),
  daemonDown,
  humanStep: daemonDown ? null : result.humanStep,
  nextStep,
}

if (json) {
  console.log(JSON.stringify(summary, null, 2))
} else if (result.ready) {
  console.log(`attached engine ready: ${summary.browsersConnected.map((b) => `${b.name} ${b.version}`).join(", ")}`)
} else {
  console.log(`cli: ${result.cli.installed ? `${result.cli.bskBin} (${result.cli.version})` : "install failed"}`)
  console.log(`daemon: ${result.daemon.running ? "running" : `not running${result.daemon.error ? ` - ${result.daemon.error}` : ""}`}`)
  console.log(summary.browser ? `browser: ${summary.browser.label} [${summary.browser.id}] (${summary.browser.reason})` : `browser: not identified (${result.identification.reason})`)
  for (const r of summary.registrations) {
    console.log(`extension for ${r.browser}: ${r.registered ? (r.alreadyPresent ? "already registered" : "registered") : `not registered (${r.reason})`}`)
  }
  if (daemonDown) {
    console.log(`\nThe BrowserSkill daemon is not running, so nothing can tell whether the extension is enabled. Do not ask the user to enable it.\n  ${nextStep}\nThen re-run browser-doctor.mjs.`)
  } else if (result.needsChoice) {
    console.log(`\nNothing was registered. ${result.humanStep}\nRe-run: node "<skill-root>/scripts/browser-install.mjs" --browser=<id>`)
  } else {
    console.log(`\nTell the user exactly this, then re-run browser-doctor.mjs:\n  ${result.humanStep}`)
  }
}
process.exitCode = result.ready ? 0 : 2
