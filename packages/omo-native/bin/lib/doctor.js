import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { packageManifest, packageRoot, readJson, resolveSenpi } from "./package-paths.js"
import { needsSetupSuggestion } from "./setup-detect.js"

const artifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
]

function pass(lines, message) {
  lines.push(`PASS ${message}`)
}

function fail(lines, message) {
  lines.push(`FAIL ${message}`)
}

function warningsForSettings() {
  const agentDir = canonicalAgentDir()
  const settingsPath = join(agentDir, "settings.json")
  if (!existsSync(settingsPath)) return []

  let settings
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch (error) {
    return [`WARN could not parse ${settingsPath}: ${error.message}`]
  }

  const packages = Array.isArray(settings?.packages) ? settings.packages : []
  const duplicate = packages.some((entry) => {
    if (typeof entry === "string") return entry === "@code-yeongyu/omo-senpi"
    return entry !== null && typeof entry === "object" && entry.source === "@code-yeongyu/omo-senpi"
  })
  return duplicate
    ? ["WARN duplicate @code-yeongyu/omo-senpi package entry; remove it from the packages array because omo loads the packaged extension"]
    : []
}

// A malformed or unreadable engine manifest must not abort the diagnostics run.
function engineVersionOrUnresolved(senpi) {
  if (!senpi) return "unresolved"
  try {
    return readJson(join(senpi.packageRoot, "package.json")).version
  } catch {
    return "unresolved"
  }
}

// The interactive engine's own command line. A published install runs it as
// `<runtime> .../@code-yeongyu/senpi/dist/cli.js --extension <plugin>`; every non-interactive
// spelling carries an explicit `--mode`, and those are owned by whoever started them.
const ENGINE_MARKER = "senpi/dist/cli.js"
const MANAGED_MODE_FLAG = "--mode"

/**
 * Reads the live process table. `ps` is the portable answer on macOS and Linux alike, and reading
 * it can never be a reason for diagnostics to fail, so an unavailable or unparsable listing is an
 * empty list.
 */
function listProcesses() {
  if (process.platform === "win32") return []
  const listed = spawnSync("ps", ["-axo", "pid=,ppid=,etime=,tty=,args="], { encoding: "utf8" })
  if (listed.status !== 0 || typeof listed.stdout !== "string") return []
  const entries = []
  for (const line of listed.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsed: match[3],
      tty: match[4],
      command: match[5],
    })
  }
  return entries
}

function isEngine(entry) {
  return entry.command.includes(ENGINE_MARKER)
}

function isInteractive(entry) {
  return !entry.command.includes(MANAGED_MODE_FLAG)
}

/**
 * Splits every engine process this machine is running into the three groups that matter:
 *   - stale:   interactive engines reparented to init, i.e. their launcher died underneath them
 *   - attached: interactive engines still owned by a live parent (somebody's session)
 *   - managed:  rpc / app-server engines, which are owned by whatever embeds them
 * Only the first group is ever reportable, and even then only as a report.
 */
export function classifyEngineProcesses(entries) {
  const stale = []
  const attached = []
  const managed = []
  for (const entry of entries) {
    if (!isEngine(entry)) continue
    if (!isInteractive(entry)) managed.push(entry)
    else if (entry.ppid === 1) stale.push(entry)
    else attached.push(entry)
  }
  return { stale, attached, managed }
}

export function formatStaleEngineLines(stale) {
  if (stale.length === 0) return []
  const lines = stale.map((entry) =>
    `WARN stale engine pid ${entry.pid} (age ${entry.elapsed}, tty ${entry.tty}) has no launcher; it was orphaned by a signaled launcher`
  )
  lines.push(`INFO reap them explicitly by pid: omo doctor --reap ${stale.map((entry) => entry.pid).join(" ")}`)
  return lines
}

function parsePid(value) {
  return /^[1-9]\d*$/.test(value) ? Number(value) : undefined
}

/**
 * Terminates named pids and nothing else. Every refusal is deliberate: a pattern kill would reach
 * live sessions, rpc hosts and app servers, so a pid is only ever signaled when the live process
 * table still shows it as an orphaned interactive engine at the moment of the request.
 */
export function reapStaleEngines(args, options = {}) {
  const lines = []
  if (args.length === 0) {
    lines.push("FAIL --reap needs the pids to terminate: omo doctor --reap <pid> [pid...]")
    return { lines, failed: true, reaped: [] }
  }

  const requested = []
  let failed = false
  for (const arg of args) {
    const pid = parsePid(arg)
    if (pid === undefined) {
      lines.push(`FAIL refusing ${JSON.stringify(arg)}: --reap takes process ids`)
      failed = true
      continue
    }
    requested.push(pid)
  }
  if (requested.length === 0) return { lines, failed: true, reaped: [] }

  const list = options.list ?? listProcesses
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal))
  const entries = list()
  const reaped = []
  for (const pid of requested) {
    const entry = entries.find((candidate) => candidate.pid === pid)
    if (!entry || !isEngine(entry)) {
      lines.push(`FAIL refusing pid ${pid}: it is not an omo engine process`)
      failed = true
      continue
    }
    if (!isInteractive(entry)) {
      lines.push(`FAIL refusing pid ${pid}: it is a managed engine (${MANAGED_MODE_FLAG}), owned by whatever started it`)
      failed = true
      continue
    }
    if (entry.ppid !== 1) {
      lines.push(`FAIL refusing pid ${pid}: its launcher (pid ${entry.ppid}) is alive, so it is a live session`)
      failed = true
      continue
    }
    try {
      kill(pid, "SIGTERM")
      reaped.push(pid)
      lines.push(`PASS reaped stale engine pid ${pid} (age ${entry.elapsed}, tty ${entry.tty})`)
    } catch (error) {
      lines.push(`FAIL could not signal pid ${pid}: ${error.message}`)
      failed = true
    }
  }
  return { lines, failed, reaped }
}

function staleEngineReport(options) {
  const list = options.list ?? listProcesses
  return formatStaleEngineLines(classifyEngineProcesses(list()).stale)
}

export function runDoctor(inventory, args = [], options = {}) {
  if (args[0] === "--reap") {
    const result = reapStaleEngines(args.slice(1), options)
    console.log(result.lines.join("\n"))
    process.exitCode = result.failed ? 1 : 0
    return
  }

  let failed = false
  const lines = []
  for (const [label, artifact] of artifacts) {
    const path = join(packageRoot, artifact)
    if (existsSync(path)) pass(lines, `${label}: ${artifact}`)
    else {
      // Report the declared posix-style artifact path so diagnostics read identically on every platform;
      // deriving it back from the joined path yields backslashes on Windows.
      fail(lines, `${label}: missing ${artifact}`)
      failed = true
    }
  }

  let senpi
  try {
    senpi = resolveSenpi()
    pass(lines, `senpi CLI: ${senpi.cliPath}`)
  } catch (error) {
    fail(lines, `senpi CLI: ${error.message}`)
    failed = true
  }

  if (senpi) {
    try {
      const expected = packageManifest().dependencies["@code-yeongyu/senpi"]
      const installed = readJson(join(senpi.packageRoot, "package.json")).version
      if (installed === expected) pass(lines, `senpi version ${installed}`)
      else {
        fail(lines, `senpi version: expected ${expected}, found ${installed}`)
        failed = true
      }
    } catch (error) {
      fail(lines, `senpi version: ${error.message}`)
      failed = true
    }
  }

  lines.push(`INFO omo ${packageManifest().version} (engine: senpi ${engineVersionOrUnresolved(senpi)})`)
  lines.push(...warningsForSettings())
  lines.push(...staleEngineReport(options))
  if (needsSetupSuggestion(inventory)) {
    lines.push("INFO no credentials found; run omo setup to review sibling stores")
  }
  console.log(lines.join("\n"))
  process.exitCode = failed ? 1 : 0
}
