/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The scripts only format omowright's reports, so a stub omowright (found through OMOWRIGHT_ROOT) that returns a
// fixed report drives every branch. The report shapes follow the omowright version pinned in the root package.json.
const scriptsDir = join(import.meta.dir, "skills", "browser", "scripts")
const stubRoot = mkdtempSync(join(tmpdir(), "omo-browser-scripts-"))
writeFileSync(
  join(stubRoot, "index.js"),
  [
    'import { readFileSync } from "node:fs"',
    "const report = () => JSON.parse(readFileSync(process.env.OMO_TEST_BSK_REPORT, \"utf8\"))",
    "export async function bskDoctor() { return report() }",
    "export async function bskOnboard() { return report() }",
  ].join("\n"),
)
afterAll(() => rmSync(stubRoot, { recursive: true, force: true }))

type Report = Record<string, unknown>
let reportCount = 0

function runScript(script: string, report: Report, args: string[] = []) {
  const reportFile = join(stubRoot, `report-${reportCount++}.json`)
  writeFileSync(reportFile, JSON.stringify(report))
  const env: Record<string, string | undefined> = { ...process.env, OMOWRIGHT_ROOT: stubRoot, OMO_TEST_BSK_REPORT: reportFile }
  delete env.OMO_BROWSER_ENGINE
  const run = spawnSync(process.execPath, [join(scriptsDir, script), ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

type Registration = { humanStep: string | null }

// The fields of the scripts' --json output that these tests read.
interface ScriptSummary {
  daemonDown?: boolean
  daemon: { startBlocked: boolean }
  humanStep?: string | null
  nextStep?: string | null
  registrations: [Registration, ...Registration[]]
  state?: string
  sessions?: unknown[]
}

function runJson(script: string, report: Report) {
  const run = runScript(script, report, ["--json"])
  expect(run.stderr).toBe("")
  return JSON.parse(run.stdout) as ScriptSummary
}

const ENABLE_STEP = "In Google Chrome, open chrome://extensions and enable BrowserSkill."
// The error the pinned omowright's doctor returns for a down daemon: it never starts one (auto-start is off).
const DOCTOR_NO_DAEMON = "no BrowserSkill daemon published at /home/u/.bsk/daemon.json and automatic start is disabled (BSK_AUTO_START=0); run `bsk daemon start` in the environment that owns it"
// What older omowright reports when it registered its scheduled-task fallback and that failed for an unrelated reason.
const SCHEDULED_TASK_DENIED = "registering the bsk daemon task exited with 1: Access is denied."
const JOB_OBJECT_REFUSAL = "bsk status exited with 1: cannot start an independent Windows daemon; the host may prohibit Job Object breakaway"

function identification() {
  return { confidence: "high", reason: "default browser", candidates: [{ id: "chrome", label: "Google Chrome", signals: ["default"] }], defaultBrowser: "chrome", registeredElsewhere: [], needsChoice: false }
}

function doctorReport(daemon: Report): Report {
  return {
    cli: { installed: true, bskBin: "bsk", version: "0.3.3" },
    daemon,
    browsers: [{ id: "chrome", userDataDir: "/profile", extensionRegistered: true }],
    primary: { id: "chrome", label: "Google Chrome" },
    identification: identification(),
    browsersConnected: [],
    ready: false,
    nextStep: daemon.running ? ENABLE_STEP : "Start the BrowserSkill daemon: run `bsk status` once, or `bsk daemon start` in the environment that owns it.",
  }
}

// The pinned omowright's bskOnboard: it registers the extension even while the daemon is down and returns no nextStep.
function onboardReport(daemon: Report): Report {
  return {
    cli: { installed: true, bskBin: "bsk", version: "0.3.3" },
    install: null,
    daemon: { browsers: [], sessions: [], ...daemon },
    browsers: [{ id: "chrome", userDataDir: "/profile", extensionRegistered: true }],
    primary: { id: "chrome", label: "Google Chrome" },
    identification: identification(),
    needsChoice: false,
    registrations: [{ browser: "chrome", registered: true, alreadyPresent: true, humanStep: ENABLE_STEP }],
    humanStep: ENABLE_STEP,
    browsersConnected: [],
    ready: false,
  }
}

describe("browser-install.mjs with the daemon down", () => {
  test("#given the pinned omowright's onboarding result #when --json runs #then it hands out the daemon step, not the extension step", () => {
    const summary = runJson("browser-install.mjs", onboardReport({ running: false, error: "daemon start was requested but /home/u/.bsk/daemon.json never appeared" }))

    expect(summary.daemonDown).toBe(true)
    expect(summary.daemon.startBlocked).toBe(false)
    expect(summary.humanStep).toBeNull()
    expect(summary.registrations[0].humanStep).toBeNull()
    expect(typeof summary.nextStep).toBe("string")
    expect(summary.nextStep).not.toBe(ENABLE_STEP)
  })

  test("#given the host refuses the detached start with the Job Object message #when --json runs #then startBlocked is set and the step differs from a plain start", () => {
    const blocked = runJson("browser-install.mjs", onboardReport({ running: false, error: JOB_OBJECT_REFUSAL }))
    const plain = runJson("browser-install.mjs", onboardReport({ running: false, error: "daemon start was requested but /home/u/.bsk/daemon.json never appeared" }))

    expect(blocked.daemon.startBlocked).toBe(true)
    expect(blocked.humanStep).toBeNull()
    expect(blocked.nextStep).not.toBe(plain.nextStep)
  })

  test("#given a scheduled-task registration that failed for another reason #when --json runs #then it is not classified as start-blocked", () => {
    const summary = runJson("browser-install.mjs", onboardReport({ running: false, error: SCHEDULED_TASK_DENIED }))
    const plain = runJson("browser-install.mjs", onboardReport({ running: false, error: "daemon start was requested but /home/u/.bsk/daemon.json never appeared" }))

    expect(summary.daemonDown).toBe(true)
    expect(summary.daemon.startBlocked).toBe(false)
    expect(summary.nextStep).toBe(plain.nextStep)
  })

  test("#given an omowright that reports startBlocked itself #when --json runs #then that value is used", () => {
    const summary = runJson("browser-install.mjs", onboardReport({ running: false, error: "anything", startBlocked: true }))

    expect(summary.daemon.startBlocked).toBe(true)
  })

  test("#given the CLI install failed #when --json runs #then the next step is the CLI, not the extension", () => {
    const failedInstall = { ...onboardReport({ running: false, error: "bsk status exited with 1: bsk: not found" }), cli: { installed: false, bskBin: null, version: null } }
    const summary = runJson("browser-install.mjs", failedInstall)
    const daemonDownOnly = runJson("browser-install.mjs", onboardReport({ running: false, error: "bsk status exited with 1: bsk: not found" }))

    expect(summary.daemonDown).toBe(true)
    expect(summary.humanStep).toBeNull()
    expect(typeof summary.nextStep).toBe("string")
    expect(summary.nextStep).not.toBe(ENABLE_STEP)
    expect(summary.nextStep).not.toBe(daemonDownOnly.nextStep)
  })

  test("#given the daemon is running and the extension is not enabled #when --json runs #then the extension step is the next step", () => {
    const summary = runJson("browser-install.mjs", onboardReport({ running: true, version: "0.3.3" }))

    expect(summary.daemonDown).toBe(false)
    expect(summary.daemon.startBlocked).toBe(false)
    expect(summary.humanStep).toBe(ENABLE_STEP)
    expect(summary.nextStep).toBe(ENABLE_STEP)
  })
})

describe("browser-doctor.mjs", () => {
  test("#given the pinned omowright's daemon-down report #when --json runs #then the state is no-daemon and no start refusal is claimed", () => {
    const summary = runJson("browser-doctor.mjs", doctorReport({ running: false, error: DOCTOR_NO_DAEMON, code: "no_daemon", browsers: [], sessions: [] }))

    expect(summary.state).toBe("no-daemon")
    expect(summary.daemon.startBlocked).toBe(false)
    expect(summary.sessions).toEqual([])
  })

  test("#given a scheduled-task registration that failed with Access is denied #when --json runs #then startBlocked is false", () => {
    const summary = runJson("browser-doctor.mjs", doctorReport({ running: false, error: SCHEDULED_TASK_DENIED, browsers: [], sessions: [] }))

    expect(summary.state).toBe("no-daemon")
    expect(summary.daemon.startBlocked).toBe(false)
  })

  test("#given a Job Object refusal in the error or from omowright #when --json runs #then startBlocked is true", () => {
    for (const daemon of [{ running: false, error: JOB_OBJECT_REFUSAL }, { running: false, error: DOCTOR_NO_DAEMON, startBlocked: true }]) {
      const summary = runJson("browser-doctor.mjs", doctorReport({ browsers: [], sessions: [], ...daemon }))

      expect(summary.state).toBe("no-daemon")
      expect(summary.daemon.startBlocked).toBe(true)
    }
  })

  test("#given open sessions, some without a valid or in-range created_at_ms #when the doctor runs #then it lists them all and does not crash", () => {
    const createdAtMs = Date.UTC(2026, 9, 28, 12, 0, 0)
    const daemon = {
      running: true,
      version: "0.3.3",
      protocolVersion: "1.3",
      browsers: [],
      sessions: [
        { session_id: "s-valid", browser_instance_id: "b1", agent_window_id: 7, created_at_ms: createdAtMs },
        { session_id: "s-missing", browser_instance_id: "b1" },
        { session_id: "s-invalid", browser_instance_id: "b1", agent_window_id: 8, created_at_ms: "not a time" },
        { session_id: "s-out-of-range", browser_instance_id: "b1", created_at_ms: 1e20 },
      ],
    }

    const text = runScript("browser-doctor.mjs", doctorReport(daemon))
    expect(text.stderr).toBe("")
    expect(text.status).toBe(0)
    const listed = text.stdout.split("\n").find((line) => line.startsWith("sessions open: "))
    expect(listed).toContain(new Date(createdAtMs).toISOString())
    for (const id of ["s-valid", "s-missing", "s-invalid", "s-out-of-range"]) expect(listed).toContain(id)

    const summary = runJson("browser-doctor.mjs", doctorReport(daemon))
    expect(summary.sessions).toEqual([
      { sessionId: "s-valid", browserInstanceId: "b1", agentWindowId: 7, createdAtMs },
      { sessionId: "s-missing", browserInstanceId: "b1", agentWindowId: null, createdAtMs: null },
      { sessionId: "s-invalid", browserInstanceId: "b1", agentWindowId: 8, createdAtMs: null },
      { sessionId: "s-out-of-range", browserInstanceId: "b1", agentWindowId: null, createdAtMs: null },
    ])
  })
})
