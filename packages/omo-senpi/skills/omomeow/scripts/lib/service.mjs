import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveHomeDir } from "./files.mjs"
import { runtimeScriptsDir } from "./system.mjs"

// The nudge runs on its own OS timer. It never touches senpi's scheduled-prompt delivery, so every
// `schedule_prompt` job keeps senpi's own runner and its busy-session guard.
export const SERVICE_LABEL = "ai.omo.omomeow-nudge"
export const SYSTEMD_SERVICE = "omomeow-nudge.service"
export const SYSTEMD_TIMER = "omomeow-nudge.timer"

export function serviceKind(platform) {
  if (platform === "darwin") return "launchd"
  if (platform === "linux") return "systemd"
  return "manual"
}

export function serviceFiles(platform, env = process.env) {
  const home = resolveHomeDir(env)
  const kind = serviceKind(platform)
  if (kind === "launchd") return [join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`)]
  if (kind === "systemd") {
    const dir = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "systemd", "user")
    return [join(dir, SYSTEMD_SERVICE), join(dir, SYSTEMD_TIMER)]
  }
  return []
}

/** What the timer runs: `nudge --scheduled` from the runtime copy, in the directory it was installed from. */
export function buildNudgeServiceSpec({ nodeBin, stateDir, intervalMinutes, cwd, env = process.env }) {
  return {
    programArgs: [nodeBin, join(runtimeScriptsDir(stateDir), "omomeow.mjs"), "nudge", "--scheduled"],
    intervalSeconds: intervalMinutes * 60,
    workingDirectory: cwd,
    env: {
      PATH: env.PATH ?? "/usr/bin:/bin",
      HOME: resolveHomeDir(env),
      OMOMEOW_HOME: stateDir,
      ...(env.OMOMEOW_HERDR_BIN ? { OMOMEOW_HERDR_BIN: env.OMOMEOW_HERDR_BIN } : {}),
    },
    logPath: join(stateDir, "logs", "nudge-service.log"),
  }
}

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

export function renderLaunchdPlist(spec) {
  const args = spec.programArgs.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n")
  const env = Object.entries(spec.env).map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(spec.workingDirectory)}</string>
  <key>StartInterval</key>
  <integer>${spec.intervalSeconds}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(spec.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(spec.logPath)}</string>
</dict>
</plist>
`
}

function systemdQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`
}

function systemdPath(value) {
  return String(value).replaceAll("%", "%%")
}

export function renderSystemdService(spec) {
  const env = Object.entries(spec.env).map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`).join("\n")
  return `[Unit]
Description=omomeow: periodic status nudge

[Service]
Type=oneshot
WorkingDirectory=${systemdPath(spec.workingDirectory)}
ExecStart=${spec.programArgs.map(systemdQuote).join(" ")}
${env}
StandardOutput=append:${systemdPath(spec.logPath)}
StandardError=append:${systemdPath(spec.logPath)}
`
}

export function renderSystemdTimer(spec) {
  return `[Unit]
Description=omomeow: periodic status nudge timer

[Timer]
OnActiveSec=${spec.intervalSeconds}
OnUnitActiveSec=${spec.intervalSeconds}
AccuracySec=30s
Unit=${SYSTEMD_SERVICE}

[Install]
WantedBy=timers.target
`
}

/** The service files for this platform, or for platforms without a supported manager the command to schedule. */
export function renderNudgeService(spec, { platform = process.platform, env = process.env } = {}) {
  const kind = serviceKind(platform)
  const paths = serviceFiles(platform, env)
  if (kind === "launchd") return { kind, files: [{ path: paths[0], content: renderLaunchdPlist(spec) }] }
  if (kind === "systemd") {
    return { kind, files: [{ path: paths[0], content: renderSystemdService(spec) }, { path: paths[1], content: renderSystemdTimer(spec) }] }
  }
  return { kind, files: [], manual: { command: spec.programArgs, everySeconds: spec.intervalSeconds, workingDirectory: spec.workingDirectory, env: spec.env } }
}

function run(spawn, command, args, required = true) {
  const result = spawn(command, args, { encoding: "utf8", windowsHide: true })
  return {
    command: [command, ...args].join(" "),
    required,
    status: result.status ?? null,
    error: result.error?.message ?? null,
    stdout: (result.stdout ?? "").trim().slice(0, 300),
    stderr: (result.stderr ?? "").trim().slice(0, 300),
  }
}

function stepFailed(step) {
  return step.required && (step.error !== null || step.status !== 0)
}

function launchdTarget(uid) {
  return { domain: `gui/${uid}`, service: `gui/${uid}/${SERVICE_LABEL}` }
}

// `launchctl print` exits 113 ("Could not find service") for a job that is not loaded.
const LAUNCHD_NOT_FOUND = 113

/** Loaded, absent, or unknown; only a positive "not found" counts as absent. */
function launchdState(spawn, uid) {
  const step = run(spawn, "launchctl", ["print", launchdTarget(uid).service], false)
  if (step.error === null && step.status === 0) return { state: "loaded", step }
  if (step.error === null && step.status === LAUNCHD_NOT_FOUND) return { state: "absent", step }
  return { state: "unknown", step: { ...step, required: true } }
}

/** Write the service files and (re)load them; `ok` is false when a required step failed. */
export function installNudgeService({ spec, platform = process.platform, env = process.env, spawn = spawnSync, uid = process.getuid?.() }) {
  const rendered = renderNudgeService(spec, { platform, env })
  if (rendered.kind === "manual") {
    return { kind: "manual", ok: false, steps: [], manual: rendered.manual, error: `no service manager support for ${platform}; run the manual command every ${spec.intervalSeconds} s with your own scheduler` }
  }
  mkdirSync(dirname(spec.logPath), { recursive: true, mode: 0o700 })
  for (const file of rendered.files) {
    mkdirSync(dirname(file.path), { recursive: true })
    writeFileSync(file.path, file.content)
  }
  const steps = []
  if (rendered.kind === "launchd") {
    const target = launchdTarget(uid)
    const current = launchdState(spawn, uid)
    steps.push(current.step)
    // A loaded job keeps its old interval until it is booted out; only a job known to be absent skips that.
    if (current.state === "loaded") steps.push(run(spawn, "launchctl", ["bootout", target.service]))
    if (!steps.some(stepFailed)) steps.push(run(spawn, "launchctl", ["bootstrap", target.domain, rendered.files[0].path]))
  } else {
    for (const args of [["daemon-reload"], ["enable", "--now", SYSTEMD_TIMER], ["restart", SYSTEMD_TIMER]]) {
      const step = run(spawn, "systemctl", ["--user", ...args])
      steps.push(step)
      if (stepFailed(step)) break
    }
  }
  return { kind: rendered.kind, ok: !steps.some(stepFailed), files: rendered.files.map((file) => file.path), steps }
}

/**
 * Stop the timer, then delete its files. When stopping fails, or launchd cannot say whether the job is
 * loaded, the files stay and `ok` is false, so a service that may still run never loses the definition
 * that would let the user remove it.
 */
export function uninstallNudgeService({ platform = process.platform, env = process.env, spawn = spawnSync, uid = process.getuid?.() }) {
  const kind = serviceKind(platform)
  const paths = serviceFiles(platform, env)
  if (kind === "manual") return { kind, ok: true, removed: [], kept: [], steps: [] }
  const steps = []
  if (kind === "launchd") {
    const current = launchdState(spawn, uid)
    steps.push(current.step)
    if (current.state === "loaded") steps.push(run(spawn, "launchctl", ["bootout", launchdTarget(uid).service]))
  } else if (paths.some((path) => existsSync(path))) {
    steps.push(run(spawn, "systemctl", ["--user", "disable", "--now", SYSTEMD_TIMER]))
  }
  if (steps.some(stepFailed)) return { kind, ok: false, removed: [], kept: paths.filter((path) => existsSync(path)), steps }
  const removed = paths.filter((path) => existsSync(path))
  for (const path of removed) rmSync(path, { force: true })
  if (kind === "systemd" && removed.length > 0) steps.push(run(spawn, "systemctl", ["--user", "daemon-reload"], false))
  return { kind, ok: true, removed, kept: [], steps }
}

export function nudgeServiceStatus({ platform = process.platform, env = process.env, spawn = spawnSync, uid = process.getuid?.() }) {
  const kind = serviceKind(platform)
  const files = serviceFiles(platform, env).map((path) => ({ path, exists: existsSync(path) }))
  let loaded = null
  if (kind === "launchd") {
    const { state } = launchdState(spawn, uid)
    loaded = state === "unknown" ? null : state === "loaded"
  } else if (kind === "systemd") {
    const step = run(spawn, "systemctl", ["--user", "is-active", SYSTEMD_TIMER], false)
    loaded = step.error === null ? step.stdout === "active" : null
  }
  return { kind, files, loaded }
}
