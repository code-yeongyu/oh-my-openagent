import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { packageManifest, packageRoot, readJson, resolveSenpi, updateTarget } from "./package-paths.js"
import { needsSetupSuggestion } from "./setup-detect.js"

const NPM_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/omo-ai/dist-tags"
const NPM_FETCH_TIMEOUT_MS = 5000

// Doctor is called without await from the launcher and the compiled entry, so the
// registry lookup has to finish before we print. A bounded child fetch keeps that
// synchronous and turns any network failure into "could not check".

export function installedDistTag(version) {
  return typeof version === "string" && version.includes("beta") ? "beta" : "latest"
}

export function latestFromDistTags(distTags, version) {
  if (distTags === null || distTags === undefined || typeof distTags !== "object") return "could not check"
  const value = distTags[installedDistTag(version)]
  return typeof value === "string" && value.length > 0 ? value : "could not check"
}

function distTagsFetchScript(url, timeoutMs) {
  return `
const url = ${JSON.stringify(url)};
const timeout = ${Number(timeoutMs)};
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), timeout);
fetch(url, { signal: ac.signal, headers: { accept: "application/json" } })
  .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.text(); })
  .then((text) => { JSON.parse(text); process.stdout.write(text); })
  .catch(() => { process.exitCode = 1; })
  .finally(() => { clearTimeout(timer); });
`
}

export function fetchNpmDistTagsSync(options = {}) {
  const spawn = options.spawn ?? spawnSync
  const url = options.url ?? NPM_DIST_TAGS_URL
  const timeoutMs = options.timeoutMs ?? NPM_FETCH_TIMEOUT_MS
  try {
    const result = spawn(process.execPath, ["-e", distTagsFetchScript(url, timeoutMs)], {
      encoding: "utf8",
      timeout: timeoutMs + 500,
      windowsHide: true,
      env: process.env,
    })
    if (result.error || result.status !== 0 || typeof result.stdout !== "string" || result.stdout.trim() === "") return null
    const parsed = JSON.parse(result.stdout)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readDistTags(options) {
  try {
    if (Object.hasOwn(options, "fetchDistTags")) return options.fetchDistTags()
    return fetchNpmDistTagsSync()
  } catch {
    return null
  }
}

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

// ps `etime` is the portable start-time signal on macOS and Linux alike; an unparsable value must
// leave the process unclassified rather than fail a diagnostic.
export function parseElapsedSeconds(elapsed) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(elapsed)
  if (!match) return undefined
  return Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3_600 + Number(match[3]) * 60 + Number(match[4])
}

function payloadDirFromCommand(command) {
  return /--extension\s+(\S+)/.exec(command)?.[1]
}

/**
 * An engine that started before ITS OWN payload was last written is executing a retired copy of it:
 * the bundle is loaded once per process while its skills and persona assets are read from that tree
 * later, so an in-place upgrade leaves the process reaching for files the tree no longer has. Each
 * engine is compared against the payload named on its own command line, because one machine runs
 * several (a global install, a compiled runtime dir, a dev staging tree) and only the one a process
 * actually loads can retire under it. Restarting the session is the only repair and it belongs to
 * whoever owns the session - nothing here may signal such a process.
 */
export function classifyRetiredPayloadEngines(entries, input) {
  const retired = []
  for (const entry of entries) {
    if (!isEngine(entry)) continue
    const elapsedSeconds = parseElapsedSeconds(entry.elapsed)
    if (elapsedSeconds === undefined) continue
    const payloadDir = payloadDirFromCommand(entry.command)
    if (payloadDir === undefined) continue
    const payloadMtimeMs = input.payloadMtimeMs(payloadDir)
    if (payloadMtimeMs === undefined) continue
    if (input.nowMs - elapsedSeconds * 1_000 < payloadMtimeMs) retired.push(entry)
  }
  return retired
}

export function formatRetiredPayloadLines(retired) {
  if (retired.length === 0) return []
  const lines = retired.map((entry) =>
    `WARN engine pid ${entry.pid} (age ${entry.elapsed}, tty ${entry.tty}) started before this payload was installed; it still runs the previous plugin copy`
  )
  lines.push("INFO restart those sessions to pick up the installed payload; a running engine is never rewritten in place")
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

// Mirrors memory-core's layout: OMO_MEMORY_HOME (relative to cwd) else ~/.omo/memory, identities
// under agents/<id>, one-shot run roots under transient-runs/<token>.
const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"
const MEMORY_AGENTS_DIRNAME = "agents"
const MEMORY_TRANSIENT_DIRNAME = "transient-runs"
const MEMORY_REPO_DIRNAME = "repo"

function memoryRoot(env) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(homedir(), ".omo", "memory")
  return resolve(process.cwd(), override)
}

// An unreadable or absent directory is `undefined`, never an empty list: the report must stay
// silent on a machine without memory instead of inventing zeros.
function listSubdirectories(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(path, entry.name))
  } catch {
    return undefined
  }
}

/**
 * A memory identity is durable exactly when it owns a `repo/`; everything else under the agents
 * root is runtime scratch a one-shot run left behind (#7765). The count is what makes an
 * unbounded pile visible before it slows every guarded tool call.
 */
export function countTransientMemoryIdentities(input) {
  const identities = input.listDirs(input.agentsRoot)
  const runs = input.listDirs(input.transientRoot)
  if (identities === undefined && runs === undefined) return undefined
  let durable = 0
  let transient = 0
  for (const identity of identities ?? []) {
    if (input.hasRepo(identity)) durable += 1
    else transient += 1
  }
  return { durable, transient, runs: (runs ?? []).length }
}

export function formatTransientMemoryLines(counts) {
  if (counts === undefined) return []
  return [
    `INFO memory identities: ${counts.durable} durable, ${counts.transient} transient (no repo/); transient run roots: ${counts.runs}`,
  ]
}

function transientMemoryReport(options) {
  const root = memoryRoot(options.env ?? process.env)
  return formatTransientMemoryLines(countTransientMemoryIdentities({
    agentsRoot: join(root, MEMORY_AGENTS_DIRNAME),
    transientRoot: join(root, MEMORY_TRANSIENT_DIRNAME),
    listDirs: options.listDirs ?? listSubdirectories,
    hasRepo: options.hasRepo ?? ((identityRoot) => existsSync(join(identityRoot, MEMORY_REPO_DIRNAME))),
  }))
}

function retiredPayloadReport(options) {
  const list = options.list ?? listProcesses
  const now = options.now ?? Date.now
  const payloadMtimeMs = options.payloadMtimeMs ?? ((payloadDir) => {
    try {
      return statSync(join(payloadDir, "extensions", "omo.js")).mtimeMs
    } catch {
      return undefined
    }
  })
  return formatRetiredPayloadLines(classifyRetiredPayloadEngines(list(), { payloadMtimeMs, nowMs: now() }))
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

  const version = packageManifest().version
  const latest = latestFromDistTags(readDistTags(options), version)
  lines.push(`INFO omo · Edition: Native · Installed: ${version} (engine: senpi ${engineVersionOrUnresolved(senpi)}) · Latest: ${latest}`)
  lines.push(`INFO Update: ${updateTarget().command}`)
  lines.push(...warningsForSettings())
  lines.push(...staleEngineReport(options))
  lines.push(...retiredPayloadReport(options))
  lines.push(...transientMemoryReport(options))
  if (needsSetupSuggestion(inventory)) {
    lines.push("INFO no credentials found; run omo setup to review sibling stores")
  }
  console.log(lines.join("\n"))
  process.exitCode = failed ? 1 : 0
}
