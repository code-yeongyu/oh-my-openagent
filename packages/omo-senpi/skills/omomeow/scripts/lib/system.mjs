import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { parseHerdrTabs } from "./nudge.mjs"
import { resolveHomeDir, SCRIPTS_DIR } from "./files.mjs"

export const SERVICE_LABEL = "ai.omo.omomeow-schedule"
export const SYSTEMD_UNIT = "omomeow-schedule.service"

/** Read the herdr tab list. A missing binary or a stopped server is reported, never thrown. */
export function readHerdrTabs({ env = process.env, spawn = spawnSync } = {}) {
  const result = spawn(env.OMOMEOW_HERDR_BIN ?? "herdr", ["tab", "list"], { encoding: "utf8", env, timeout: 30000, windowsHide: true })
  if (result.error) return { available: false, error: result.error.code === "ENOENT" ? "herdr not found on PATH" : result.error.message, tabs: [] }
  if (result.status !== 0) return { available: false, error: `herdr tab list exited ${result.status}: ${(result.stderr ?? "").trim().slice(0, 300)}`, tabs: [] }
  return { available: true, error: null, tabs: parseHerdrTabs(result.stdout) }
}

/** Send one message through an agent-messenger bot CLI (`agent-discordbot`, `agent-telegrambot`, ...). */
export function sendMessage(recipient, text, { env = process.env, spawn = spawnSync } = {}) {
  if (typeof recipient?.platform !== "string" || !/^[a-z][a-z0-9]*bot$/.test(recipient.platform)) {
    throw new Error(`recipient platform must be an agent-messenger bot CLI suffix such as discordbot, got ${JSON.stringify(recipient?.platform)}`)
  }
  if (typeof recipient.target !== "string" || recipient.target.length === 0) throw new Error("recipient target is required")
  const args = []
  if (recipient.bot) args.push("--bot", recipient.bot)
  args.push("message", "send", recipient.target, text)
  const result = spawn(`agent-${recipient.platform}`, args, { encoding: "utf8", env, timeout: 60000, windowsHide: true })
  if (result.error) throw new Error(`agent-${recipient.platform}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`agent-${recipient.platform} exited ${result.status}: ${`${result.stderr ?? ""}${result.stdout ?? ""}`.trim().slice(0, 500)}`)
  }
  let messageId = null
  try {
    const parsed = JSON.parse(result.stdout)
    messageId = parsed?.id ?? parsed?.message_id ?? parsed?.ts ?? null
  } catch {
    messageId = null
  }
  return { messageId }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

export function isOurHook(exec) {
  return typeof exec === "string" && exec.includes("omomeow.mjs") && exec.includes("schedule-hook")
}

/** Live `senpi schedule run` processes for this agent dir, read from their lease files. */
export function readRunnerLeases(agentDir) {
  const dir = join(agentDir, "schedule", "runners")
  if (!existsSync(dir)) return []
  const leases = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    try {
      const lease = JSON.parse(readFileSync(join(dir, name), "utf8"))
      if (!Number.isInteger(lease.pid)) continue
      leases.push({ pid: lease.pid, alive: isAlive(lease.pid), watch: lease.watch === true, exec: lease.exec ?? null, ours: isOurHook(lease.exec) })
    } catch {
      continue
    }
  }
  return leases
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

export function findOnPath(command, env = process.env) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = join(dir, command)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      continue
    }
  }
  return null
}

export function runtimeScriptsDir(stateDir) {
  return join(stateDir, "runtime", "scripts")
}

function digestTree(root) {
  const hash = createHash("sha256")
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "tests") continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) hash.update(path.slice(root.length)).update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest("hex")
}

/**
 * The runner service points at a copy of these scripts under the state dir, so a skill path that moves
 * with every omo update never breaks it. Refresh the copy whenever the shipped scripts differ.
 */
export function syncRuntime(stateDir, { source = SCRIPTS_DIR } = {}) {
  const target = runtimeScriptsDir(stateDir)
  const sourceDigest = digestTree(source)
  const currentDigest = existsSync(target) ? digestTree(target) : null
  if (currentDigest === sourceDigest) return { path: target, changed: false }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true, mode: 0o700 })
  cpSync(source, target, { recursive: true, filter: (path) => !path.slice(source.length).split(/[\\/]/).includes("tests") })
  return { path: target, changed: true }
}

export function buildRunnerSpec({ senpiBin, agentDir, stateDir, nodeBin, env = process.env }) {
  const hookScript = join(runtimeScriptsDir(stateDir), "omomeow.mjs")
  const hook = `${shellQuote(nodeBin)} ${shellQuote(hookScript)} schedule-hook`
  return {
    programArgs: [senpiBin, "schedule", "run", "--watch", "--exec", hook],
    env: {
      PATH: env.PATH ?? "/usr/bin:/bin",
      HOME: resolveHomeDir(env),
      SENPI_CODING_AGENT_DIR: agentDir,
      OMOMEOW_HOME: stateDir,
      OMOMEOW_SENPI_BIN: senpiBin,
    },
    logPath: join(stateDir, "logs", "schedule-runner.log"),
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
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
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

export function renderSystemdUnit(spec) {
  const env = Object.entries(spec.env).map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`).join("\n")
  return `[Unit]
Description=omomeow: senpi scheduled prompt runner

[Service]
ExecStart=${spec.programArgs.map(systemdQuote).join(" ")}
${env}
Restart=always
RestartSec=5
StandardOutput=append:${spec.logPath}
StandardError=append:${spec.logPath}

[Install]
WantedBy=default.target
`
}

export function serviceFilePath(platform, env = process.env) {
  const home = resolveHomeDir(env)
  if (platform === "darwin") return join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`)
  if (platform === "linux") return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "systemd", "user", SYSTEMD_UNIT)
  return null
}

function run(spawn, command, args, required = true) {
  const result = spawn(command, args, { encoding: "utf8", windowsHide: true })
  return { command: [command, ...args].join(" "), required, status: result.status, error: result.error?.message ?? null, stderr: (result.stderr ?? "").trim().slice(0, 300) }
}

/** Write the service file and (re)load it. Returns the steps run so the caller can report them. */
export function installRunnerService({ spec, platform = process.platform, env = process.env, spawn = spawnSync }) {
  const path = serviceFilePath(platform, env)
  if (path === null) throw new Error(`no service manager support for ${platform}; run \`${spec.programArgs.map(shellQuote).join(" ")}\` under your own supervisor`)
  mkdirSync(join(path, ".."), { recursive: true })
  mkdirSync(join(spec.logPath, ".."), { recursive: true, mode: 0o700 })
  const steps = []
  if (platform === "darwin") {
    writeFileSync(path, renderLaunchdPlist(spec))
    const domain = `gui/${process.getuid()}`
    // bootout fails when the service is not loaded yet; only bootstrap has to succeed.
    steps.push(run(spawn, "launchctl", ["bootout", `${domain}/${SERVICE_LABEL}`], false))
    steps.push(run(spawn, "launchctl", ["bootstrap", domain, path]))
  } else {
    writeFileSync(path, renderSystemdUnit(spec))
    steps.push(run(spawn, "systemctl", ["--user", "daemon-reload"]))
    steps.push(run(spawn, "systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]))
    steps.push(run(spawn, "systemctl", ["--user", "restart", SYSTEMD_UNIT]))
  }
  return { path, steps }
}

export function uninstallRunnerService({ platform = process.platform, env = process.env, spawn = spawnSync }) {
  const path = serviceFilePath(platform, env)
  if (path === null) return { path: null, steps: [] }
  const steps = []
  if (platform === "darwin") steps.push(run(spawn, "launchctl", ["bootout", `gui/${process.getuid()}/${SERVICE_LABEL}`]))
  else steps.push(run(spawn, "systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]))
  rmSync(path, { force: true })
  return { path, steps }
}
