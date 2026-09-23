#!/usr/bin/env node
import { loadOmowright } from "./omowright.mjs"

const json = process.argv.includes("--json")
const waitArg = process.argv.find((arg) => arg.startsWith("--wait-ms="))
const waitTotalMs = waitArg ? Number(waitArg.slice("--wait-ms=".length)) : 0

const { omowright } = await loadOmowright()
const steps = []
const result = await omowright.bskOnboard({
  onHumanStep: (step) => steps.push(step),
  waitForBrowserMs: waitTotalMs > 0 ? Math.min(15_000, waitTotalMs) : 0,
  waitTotalMs,
})

const summary = {
  ready: result.ready,
  cli: result.cli,
  installerRan: result.install !== null,
  daemon: { running: result.daemon.running, version: result.daemon.version ?? null, error: result.daemon.error ?? null },
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
  for (const r of summary.registrations) {
    console.log(`extension for ${r.browser}: ${r.registered ? (r.alreadyPresent ? "already registered" : "registered") : `not registered (${r.reason})`}`)
  }
  console.log(`\nTell the user exactly this, then re-run browser-doctor.mjs:\n  ${result.humanStep}`)
}
process.exitCode = result.ready ? 0 : 2
