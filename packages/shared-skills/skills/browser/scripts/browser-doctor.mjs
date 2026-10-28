#!/usr/bin/env node
import { loadOmowright } from "./omowright.mjs"

const { entry, omowright } = await loadOmowright()
const browserArg = process.argv.find((arg) => arg.startsWith("--browser="))
const report = await omowright.bskDoctor({ waitForBrowserMs: 0, browser: browserArg ? browserArg.slice("--browser=".length) : undefined })

const state = report.ready
  ? "ready"
  : !report.cli.installed
    ? "no-cli"
    : !report.daemon.running
      ? "no-daemon"
      : report.browsers.length === 0 && !report.primary
        ? "no-browser-support"
        : report.identification.needsChoice
          ? "choose-browser"
          : "no-extension"

const startBlocked = report.daemon.startBlocked ?? /Job Object|breakaway/i.test(report.daemon.error ?? "")
const sessions = (report.daemon.sessions ?? []).map((s) => ({ sessionId: s.session_id, browserInstanceId: s.browser_instance_id, agentWindowId: s.agent_window_id ?? null, createdAtMs: Number.isFinite(s.created_at_ms) ? s.created_at_ms : null }))
const SESSIONS_NOTE = sessions.length > 0
  ? `\n${sessions.length} BrowserSkill session(s) are open, each with an Agent Window. Any you did not start in this task was left by an earlier or cancelled task: stop it with \`bsk session stop <id>\` (the daemon also stops sessions idle for 5 minutes).`
  : ""

const REMEDIES = {
  ready: "Attached engine is live: const { connectBrowserSkill } = await import(omowrightEntry); const session = await connectBrowserSkill({ name: \"<task>\", focused: false })",
  "no-cli": "Run node \"<skill-root>/scripts/browser-install.mjs\". It installs the CLI, starts the daemon and registers the extension; then tell the user the single step it prints.",
  "no-daemon": startBlocked
    ? "This host forbids the daemon from detaching (Windows Job Object breakaway), so retrying `bsk status` or `bsk daemon start` fails the same way. Run `bsk daemon start --foreground` in a persistent background session that outlives the command, then re-run this doctor from a separate call. Do not ask the user to enable the extension: nothing can see it until the daemon runs."
    : "Run node \"<skill-root>/scripts/browser-install.mjs\" (it starts the daemon through `bsk status`), then re-run this doctor. If the daemon still does not run, run `bsk daemon start --foreground` in a persistent background session. Do not ask the user to enable the extension: nothing can see it until the daemon runs.",
  "no-extension": report.nextStep ?? "Register the extension with browser-install.mjs, then relay its human step to the user and re-run this doctor.",
  "choose-browser": `Do not install anything yet. First check your memory for the browser this user works in; if it names one of the candidates, re-run with --browser=<id>. Otherwise ask the user which browser they actually use (${report.identification.reason}), record the answer in memory, then run node "<skill-root>/scripts/browser-install.mjs" --browser=<id>.`,
  "no-browser-support": "No Chromium-family browser profile was found on this machine. Say so and stop; do not substitute another engine.",
}

const summary = {
  state,
  omowright: entry,
  cli: report.cli,
  daemon: { running: report.daemon.running, version: report.daemon.version ?? null, protocolVersion: report.daemon.protocolVersion ?? null, error: report.daemon.error ?? null, startBlocked },
  sessions,
  browser: report.primary ? { id: report.primary.id, label: report.primary.label, confidence: report.identification.confidence, reason: report.identification.reason } : null,
  candidates: report.identification.candidates.map((c) => ({ id: c.id, label: c.label, signals: c.signals })),
  defaultBrowser: report.identification.defaultBrowser,
  registeredElsewhere: report.identification.registeredElsewhere,
  browsersDetected: report.browsers.map((browser) => ({ id: browser.id, userDataDir: browser.userDataDir, extensionRegistered: browser.extensionRegistered })),
  browsersConnected: report.browsersConnected.map((browser) => ({ instanceId: browser.instance_id, name: browser.browser_name, version: browser.browser_version })),
  nextStep: report.nextStep,
  remedy: REMEDIES[state] + SESSIONS_NOTE,
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`state: ${state}`)
  console.log(`omowright: ${entry}`)
  console.log(`cli: ${report.cli.installed ? `${report.cli.bskBin} (${report.cli.version})` : "not installed"}`)
  console.log(`daemon: ${report.daemon.running ? `running (${report.daemon.version}, protocol ${report.daemon.protocolVersion})` : `not running${report.daemon.error ? ` - ${report.daemon.error}` : ""}`}`)
  console.log(`browser the user uses: ${summary.browser ? `${summary.browser.label} [${summary.browser.id}] (${summary.browser.reason})` : `not identified (${report.identification.reason})`}`)
  console.log(`candidates: ${summary.candidates.map((c) => `${c.id}${c.signals.length ? ` (${c.signals.join(", ")})` : ""}`).join(", ") || "none"}`)
  if (summary.registeredElsewhere.length > 0) console.log(`extension entries left in other browsers: ${summary.registeredElsewhere.join(", ")} (not removed automatically)`)
  console.log(`browsers detected: ${summary.browsersDetected.map((b) => `${b.id}${b.extensionRegistered ? " (extension registered)" : ""}`).join(", ") || "none"}`)
  console.log(`browsers connected: ${summary.browsersConnected.map((b) => `${b.name} ${b.version} [${b.instanceId}]`).join(", ") || "none"}`)
  console.log(`sessions open: ${sessions.map((s) => `${s.sessionId} (browser ${s.browserInstanceId}, window ${s.agentWindowId ?? "-"}${s.createdAtMs === null ? "" : `, since ${new Date(s.createdAtMs).toISOString()}`})`).join(", ") || "none"}`)
  console.log(`\n${summary.remedy}`)
}
