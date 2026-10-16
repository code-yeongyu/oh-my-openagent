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

const summary = {
  ready: result.ready,
  cli: result.cli,
  installerRan: result.install !== null,
  daemon: { running: result.daemon.running, version: result.daemon.version ?? null, error: result.daemon.error ?? null },
  browser: result.primary ? { id: result.primary.id, label: result.primary.label, confidence: result.identification.confidence, reason: result.identification.reason } : null,
  needsChoice: result.needsChoice,
  candidates: result.identification.candidates.map((c) => ({ id: c.id, label: c.label, signals: c.signals })),
  registeredElsewhere: result.identification.registeredElsewhere,
  registrations: result.registrations.map((r) => ({ browser: r.browser, registered: r.registered, alreadyPresent: r.alreadyPresent ?? false, reason: r.reason ?? null, needsRestart: r.needsRestart ?? null, humanStep: r.humanStep ?? null })),
  browsersConnected: result.browsersConnected.map((b) => ({ instanceId: b.instance_id, name: b.browser_name, version: b.browser_version })),
  humanStep: result.humanStep,
}

if (json) {
  console.log(JSON.stringify(summary, null, 2))
} else if (result.ready) {
  console.log(`attached engine ready: ${summary.browsersConnected.map((b) => `${b.name} ${b.version}`).join(", ")}`)
} else {
  console.log(`cli: ${result.cli.installed ? `${result.cli.bskBin} (${result.cli.version})` : "install failed"}`)
  console.log(`daemon: ${result.daemon.running ? "running" : `not running${result.daemon.error ? ` — ${result.daemon.error}` : ""}`}`)
  console.log(summary.browser ? `browser: ${summary.browser.label} [${summary.browser.id}] (${summary.browser.reason})` : `browser: not identified (${result.identification.reason})`)
  for (const r of summary.registrations) {
    console.log(`extension for ${r.browser}: ${r.registered ? (r.alreadyPresent ? "already registered" : "registered") : `not registered (${r.reason})`}`)
  }
  if (result.needsChoice) {
    console.log(`\nNothing was registered. ${result.humanStep}\nRe-run: node "<skill-root>/scripts/browser-install.mjs" --browser=<id>`)
  } else {
    console.log(`\nTell the user exactly this, then re-run browser-doctor.mjs:\n  ${result.humanStep}`)
  }
}
process.exitCode = result.ready ? 0 : 2
