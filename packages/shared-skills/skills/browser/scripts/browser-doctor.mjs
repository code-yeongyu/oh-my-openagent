#!/usr/bin/env node
import { runBrowserDoctor } from "./browser-doctor-report.mjs"
import { loadOmowright } from "./omowright.mjs"

const { entry, omowright } = await loadOmowright()
const browserArg = process.argv.find((arg) => arg.startsWith("--browser="))
const { identificationReason, ...summary } = await runBrowserDoctor({
  omowright,
  entry,
  browser: browserArg ? browserArg.slice("--browser=".length) : undefined,
})

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`state: ${summary.state}`)
  console.log(`omowright: ${entry}`)
  console.log(`cli: ${summary.cli.installed ? `${summary.cli.bskBin} (${summary.cli.version})` : "not installed"}`)
  console.log(
    `daemon: ${summary.daemon.running ? `running (${summary.daemon.version}, protocol ${summary.daemon.protocolVersion})` : `not running${summary.daemon.error ? ` - ${summary.daemon.error}` : ""}`}`,
  )
  console.log(
    `browser the user uses: ${summary.browser ? `${summary.browser.label} [${summary.browser.id}] (${summary.browser.reason})` : `not identified (${identificationReason})`}`,
  )
  console.log(
    `candidates: ${summary.candidates.map((c) => `${c.id}${c.signals.length ? ` (${c.signals.join(", ")})` : ""}`).join(", ") || "none"}`,
  )
  if (summary.registeredElsewhere.length > 0)
    console.log(
      `extension entries left in other browsers: ${summary.registeredElsewhere.join(", ")} (not removed automatically)`,
    )
  console.log(
    `browsers detected: ${summary.browsersDetected.map((b) => `${b.id}${b.extensionRegistered ? " (extension registered)" : ""}`).join(", ") || "none"}`,
  )
  console.log(
    `browsers connected: ${summary.browsersConnected.map((b) => `${b.name} ${b.version} [${b.instanceId}]${b.extensionVersion ? ` extension ${b.extensionVersion}` : ""}`).join(", ") || "none"}`,
  )
  console.log(`\n${summary.remedy}`)
}
