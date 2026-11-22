// The browser doctor's report: one bskDoctor run turned into the `state` the browser skill routes on, its remedy, and a
// summary. browser-doctor.mjs is the CLI over it; `doctorOptions` reach bskDoctor unchanged (the CLI passes none).

// BrowserSkill extension 0.4.0 put every task tab into a native "BrowserSkill" tab group that the browser saves and
// syncs, so each task left a group in the user's own browser (upstream removed the grouping in 0.4.1).
const TAB_GROUPING_EXTENSION_VERSION = "0.4.0"

function stateOf(report, outdated) {
  if (report.browsersConnected.length > outdated.length) return "ready"
  if (outdated.length > 0) return "outdated-extension"
  if (!report.cli.installed) return "no-cli"
  if (!report.daemon.running) return "no-daemon"
  if (report.browsers.length === 0 && !report.primary) return "no-browser-support"
  return report.identification.needsChoice ? "choose-browser" : "no-extension"
}

const named = (browsers) => browsers.map((browser) => `${browser.browser_name} [${browser.instance_id}]`).join(", ")

// With a 0.4.0 browser connected beside an up-to-date one, a session started without `browser` may land on the 0.4.0
// one (the daemon picks), so the remedy names the up-to-date browser's instance and lists the browsers to avoid.
function readyRemedy(report, outdated) {
  const live = "Attached engine is live: const { connectBrowserSkill } = await import(omowrightEntry); "
  if (outdated.length === 0)
    return `${live}const session = await connectBrowserSkill({ name: "<task>", focused: false })`
  const usable = report.browsersConnected.filter((connected) => !outdated.includes(connected))
  const others = usable.length > 1 ? ` (or another up-to-date browser: ${named(usable.slice(1))})` : ""
  return `${live}const session = await connectBrowserSkill({ name: "<task>", focused: false, browser: "${usable[0].instance_id}" })${others}. Always pass browser: the BrowserSkill extension in ${named(outdated)} is 0.4.0, which leaves a "BrowserSkill" tab group in the user's browser after every task; never start a session there, and ask the user to update it to 0.4.1 or later and delete any saved "BrowserSkill" tab groups by hand.`
}

function remedyFor(state, report, outdated) {
  switch (state) {
    case "ready":
      return readyRemedy(report, outdated)
    case "outdated-extension":
      return `The connected BrowserSkill extension is 0.4.0 (${named(outdated)}), which leaves a "BrowserSkill" tab group in the user's browser after every task. Do not start a session. Ask the user to update the extension to 0.4.1 or later (chrome://extensions, Developer mode, Update) and to delete any saved "BrowserSkill" tab groups by hand, then re-run this doctor.`
    case "no-cli":
      return 'Run node "<skill-root>/scripts/browser-install.mjs". It installs the CLI, starts the daemon and registers the extension; then tell the user the single step it prints.'
    case "no-daemon":
      return 'Run node "<skill-root>/scripts/browser-install.mjs" (it starts the daemon through `bsk status`), then re-run this doctor.'
    case "no-extension":
      return (
        report.nextStep ??
        "Register the extension with browser-install.mjs, then relay its human step to the user and re-run this doctor."
      )
    case "choose-browser":
      return `Do not install anything yet. First check your memory for the browser this user works in; if it names one of the candidates, re-run with --browser=<id>. Otherwise ask the user which browser they actually use (${report.identification.reason}), record the answer in memory, then run node "<skill-root>/scripts/browser-install.mjs" --browser=<id>.`
    case "no-browser-support":
      return "No Chromium-family browser profile was found on this machine. Say so and stop; do not substitute another engine."
  }
}

/** @param {{ omowright: any, entry: string | undefined, browser?: string, doctorOptions?: Record<string, unknown> }} options */
export async function runBrowserDoctor({ omowright, entry, browser, doctorOptions = {} }) {
  const report = await omowright.bskDoctor({ waitForBrowserMs: 0, browser, ...doctorOptions })
  const outdated = report.browsersConnected.filter(
    (connected) => connected.extension_version === TAB_GROUPING_EXTENSION_VERSION,
  )
  const state = stateOf(report, outdated)
  return {
    state,
    omowright: entry,
    cli: report.cli,
    daemon: {
      running: report.daemon.running,
      version: report.daemon.version ?? null,
      protocolVersion: report.daemon.protocolVersion ?? null,
      error: report.daemon.error ?? null,
    },
    browser: report.primary
      ? {
          id: report.primary.id,
          label: report.primary.label,
          confidence: report.identification.confidence,
          reason: report.identification.reason,
        }
      : null,
    identificationReason: report.identification.reason,
    candidates: report.identification.candidates.map((c) => ({ id: c.id, label: c.label, signals: c.signals })),
    defaultBrowser: report.identification.defaultBrowser,
    registeredElsewhere: report.identification.registeredElsewhere,
    browsersDetected: report.browsers.map((detected) => ({
      id: detected.id,
      userDataDir: detected.userDataDir,
      extensionRegistered: detected.extensionRegistered,
    })),
    browsersConnected: report.browsersConnected.map((connected) => ({
      instanceId: connected.instance_id,
      name: connected.browser_name,
      version: connected.browser_version,
      extensionVersion: connected.extension_version ?? null,
    })),
    nextStep: report.nextStep,
    remedy: remedyFor(state, report, outdated),
  }
}
