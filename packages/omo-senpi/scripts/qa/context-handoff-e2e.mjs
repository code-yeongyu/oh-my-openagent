#!/usr/bin/env bun
// Live compaction-failure handoff proof against the real Senpi CLI.
// RPC is used because its extension command context supports newSession and stays
// alive across follow-ups. The live event/session evidence records whether that
// contract actually works; print mode (-p) may exit before follow-ups run.
// A successful RPC replacement and seeded response are required, never simulated.
// RPC was observed to dispatch the command, replace the session and deliver the
// seed. Manual RPC compact exercises the real summarizer and lifecycle events.
// A read-only sandbox extension logs host events; it never injects a failure.
// allow: SIZE_OK - live scenarios, process ownership and attribution evidence share one scoped driver.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, credentialDigest, digestDirectory, seedSandbox, snapshotDirectory } from "./drive.mjs"
import { changedSnapshotPaths, protectedSnapshotsUntouched, snapshotProtectedState } from "./isolation-state.mjs"
import { messageText, readEntries, watchUntil } from "./kibitzer-sidecar-support.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../../..")
const FACTS = ["FACT-ALPHA-7341", "FACT-BRAVO-2290", "FACT-CHARLIE-5518"]
const REQUEST_TYPE = "omo-senpi:context-handoff"
const SEED = "<omo-context-handoff-seed>"
const INITIAL = "CONTEXT_HANDOFF_QA_INITIAL"
const RESUMED = "CONTEXT_HANDOFF_QA_RESUMED"
const PREPARE = "CONTEXT_HANDOFF_QA_PREPARE"
const POST_COMPACT = "CONTEXT_HANDOFF_QA_POST_COMPACT"
const LOOP_PROBE = "CONTEXT_HANDOFF_QA_LOOP_PROBE"
const SUMMARY_OVERFLOW_MARKER = "QA_OVERSIZED_COMPACTION_SUMMARY"
const FAILED_REJECTIONS = new Set(["would-overflow", "circuit-breaker", "per-turn-cap"])
const HANDOFF_ERROR = "QA_HANDOFF_AGENT_ERROR"
const TIMEOUT = 60_000
// The live Mac agent's installed runtimes contain 43k files / 1.13GB.
// These finite budgets include them rather than silently omitting installations.
const HOME_LIMITS = { maxFiles: 100000, maxEntries: 200000, maxBytes: 2 * 1024 ** 3 }

function createSeededSandbox() {
  const sandbox = createSandbox()
  // The shared seeder invokes POSIX mkdir -p, which is unavailable on native Windows.
  for (const path of [sandbox.cwd, sandbox.agentDir, sandbox.homeDir,
    sandbox.xdgConfigHome, sandbox.xdgDataHome, sandbox.xdgCacheHome])
    mkdirSync(path, { recursive: true })
  seedSandbox(sandbox)
  return sandbox
}

function parseArgs(argv) {
  const options = { selfTest: false, evidenceDir: undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--self-test") options.selfTest = true
    else if (argv[i] === "--evidence-dir" && argv[i + 1]) options.evidenceDir = resolve(argv[++i])
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`)
  }
  if (!options.selfTest && !options.evidenceDir) throw new Error("--evidence-dir is required")
  return options
}

function resolveCli() {
  const cli = process.env.SENPI_BIN || join(repoRoot, "node_modules/@code-yeongyu/senpi/dist/cli.js")
  if (!existsSync(cli)) throw new Error(`Senpi binary not found: ${cli}`)
  return /\.(?:m?js|cjs)$/u.test(cli)
    ? { file: process.env.BUN_BIN || process.execPath, prefix: [resolve(cli)] }
    : { file: resolve(cli), prefix: [] }
}

function allFiles(root, suffix) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = join(root, entry.name)
    return entry.isDirectory() ? allFiles(file, suffix) : entry.isFile() && file.endsWith(suffix) ? [file] : []
  }).sort()
}

function sessionsIn(root) {
  return allFiles(root, ".jsonl").map((file) => ({ file, entries: readEntries(file) }))
}

function users(entries) {
  return entries.filter((entry) => entry.type === "message" && entry.message?.role === "user")
}

function requests(entries) {
  return entries.filter((entry) => entry.type === "custom_message" && entry.customType === REQUEST_TYPE)
}

function hasFacts(text) {
  return FACTS.every((fact) => text.includes(fact))
}

// Parse the actual model-visible request, including Windows paths with spaces.
function handoffPathFrom(body) {
  const texts = (body.messages ?? []).filter((message) => message.role === "user").map(messageText)
  const request = texts.findLast((text) => text.includes("<omo-context-handoff>"))
  const path = request?.split(/\r?\n/u).map((line) => line.trim())
    .find((line) => /[\\/]\.omo[\\/]handoffs[\\/][^\\/]+\.md$/u.test(line))
  if (!path) throw new Error("handoff request has no absolute handoff path")
  return path
}

function mockRouter(logPath, scenario = "healthy-compaction") {
  let cursor = 0
  let handoffPath
  let compacting = false
  return {
    steps(body) {
      // Senpi's core-route summarizer can retain the ordinary agent tools. Route
      // by the owned RPC compact interval, not tools or natural-language prompts.
      const lane = compacting ? "compaction" : "agent"
      appendFileSync(logPath, `${JSON.stringify({ requestIndex: cursor, lane, body })}\n`)
      const userMessages = (body.messages ?? []).filter((message) => message.role === "user")
      const first = messageText(userMessages[0])
      const last = messageText(userMessages.at(-1))
      let step
      if (lane === "compaction") {
        step = scenario === "healthy-compaction"
          ? { type: "text", text: `# Context checkpoint\n${FACTS.join("\n")}\nContinue the QA task.` }
          // Garbage from the wire exceeds the real model's context window. The
          // host must reject it through its actual would-overflow admission path.
          : { type: "text", text: `<summary>\n${`${SUMMARY_OVERFLOW_MARKER} `.repeat(40000)}\n</summary>` }
      } else if (last.includes(LOOP_PROBE)) {
        step = { type: "text", text: LOOP_PROBE }
      } else if (first.includes(SEED)) {
        step = { type: "text", text: RESUMED }
      } else if (userMessages.some((message) => messageText(message).includes("<omo-context-handoff>"))) {
        handoffPath = handoffPathFrom(body)
        // Prove the production fallback writes the file from persisted user facts.
        step = { type: "error", status: 400, body: { error: { message: HANDOFF_ERROR, type: "invalid_request_error" } } }
      } else if (last.includes(POST_COMPACT)) {
        step = { type: "text", text: POST_COMPACT }
      } else if (last.includes(PREPARE)) {
        step = { type: "text", text: PREPARE }
      } else {
        step = { type: "text", text: INITIAL }
      }
      // 20%: above the handoff threshold but below automatic compaction. Summary
      // usage is small; all agent responses, including the seed, report high usage.
      const input = lane === "compaction" ? 100 : 40000
      step.usage = { prompt_tokens: input, completion_tokens: 3, total_tokens: input + 3 }
      // The shared HTTP server indexes its returned script by the global cursor.
      return Array(++cursor).fill(step)
    },
    setCompacting(value) { compacting = value },
    get handoffPath() { return handoffPath },
  }
}

function launch(command, sandbox, env, evidence) {
  const args = [...command.prefix, "--mode", "rpc", "-e", join(scriptDir, "environment-receipt.ts"),
    "-e", sandbox.observerPath,
    "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sandbox.sessionsDir]
  const child = spawn(command.file, args, {
    cwd: sandbox.cwd, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
  })
  const events = []
  const waiters = new Set()
  let stderr = ""
  let failure
  const fail = (error) => {
    failure = error
    for (const waiter of waiters) waiter.finish(error)
  }
  child.once("error", fail)
  const exited = new Promise((done) => child.once("close", (code, signal) => {
    fail(new Error(`Senpi exited: code=${code}, signal=${signal}`))
    done({ code, signal })
  }))
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
    appendFileSync(join(evidence, "stderr.log"), chunk)
  })
  createInterface({ input: child.stdout }).on("line", (line) => {
    appendFileSync(join(evidence, "stdout.jsonl"), `${line}\n`)
    let event
    try { event = JSON.parse(line) } catch { return }
    events.push(event)
    for (const waiter of waiters) if (waiter.predicate(event)) waiter.finish(undefined, event)
  })
  function wait(predicate, label, from = 0, timeout = TIMEOUT) {
    const found = events.slice(from).find(predicate)
    if (found) return Promise.resolve(found)
    if (failure) return Promise.reject(failure)
    return new Promise((done, reject) => {
      const waiter = {
        predicate,
        finish(error, event) {
          clearTimeout(timer)
          waiters.delete(waiter)
          if (error) reject(error)
          else done(event)
        },
      }
      const timer = setTimeout(() => waiter.finish(new Error(`${label} timed out after ${timeout}ms`)), timeout)
      waiters.add(waiter)
    })
  }
  let id = 0
  async function request(type, payload = {}, allowFailure = false) {
    const requestId = `qa-${++id}`
    const response = wait((event) => event.type === "response" && event.id === requestId, type)
    child.stdin.write(`${JSON.stringify({ type, id: requestId, ...payload })}\n`)
    const result = await response
    if (!result.success && !allowFailure) throw new Error(`${type}: ${result.error}`)
    if (allowFailure) return result
    return result.data
  }
  async function turn(message, answer = message) {
    const from = events.length
    const ended = wait((event) => event.type === "agent_end" && event.messages?.some((entry) =>
      entry.role === "assistant" && messageText(entry) === answer), `${answer} agent_end`, from)
    const acknowledged = request("prompt", { message })
    const [event] = await Promise.all([ended, acknowledged])
    await wait((entry) => entry.type === "agent_idle", `${answer} agent_idle`, events.indexOf(event) + 1)
  }
  return { child, events, wait, request, turn, exited, stderr: () => stderr, command: [command.file, ...args] }
}

function installObserver(sandbox) {
  sandbox.observerPath = join(sandbox.cwd, "qa-observer.mjs")
  const trace = join(sandbox.cwd, "host-events.jsonl")
  const identity = join(sandbox.cwd, "child-identity.json")
  writeFileSync(sandbox.observerPath, [
    'import { appendFileSync, writeFileSync } from "node:fs";',
    "export default function observe(pi) {",
    `  writeFileSync(${JSON.stringify(identity)}, JSON.stringify({pid: process.pid, ppid: process.ppid, env: Object.fromEntries(["HOME","USERPROFILE","XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_CACHE_HOME","OMO_CODING_AGENT_DIR","SENPI_CODING_AGENT_DIR","PI_CODING_AGENT_DIR"].map(key => [key, process.env[key]]))}));`,
    '  for (const type of ["session_compact", "session_compact_failed", "agent_settled", "message_start"]) {',
    '    pi.on(type, (payload, ctx) => {',
    `      if (type !== "message_start" || payload.message?.customType === ${JSON.stringify(REQUEST_TYPE)}) appendFileSync(${JSON.stringify(trace)}, JSON.stringify({type, payload, sessionId: ctx.sessionManager.getSessionId(), isCompacting: ctx.isCompacting(), usage: ctx.getContextUsage(), at: Date.now()}) + "\\n");`,
    "    });",
    "  }",
    "}",
  ].join("\n"))
  return trace
}

async function stop(session, ownedPids = new Set([session.child.pid])) {
  const { child } = session
  if (child.exitCode !== null || child.signalCode !== null) return await session.exited
  // Kill the owned tree, not only its leader. Await the exit event with a deadline.
  const exit = deadline(session.exited, TIMEOUT, "process-tree exit")
  if (process.platform === "win32") {
    // Observe both promises immediately: waiting for taskkill first can leave an
    // earlier exit timeout unhandled while native Windows is still terminating.
    const [result, killCode] = await Promise.all([exit, deadline(new Promise((done, reject) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
      killer.once("error", reject)
      killer.once("exit", done)
    }), TIMEOUT, "taskkill")])
    // taskkill can report 128 when a descendant exits during its tree walk.
    // Certify termination from actual PID liveness, not the utility's exit alone.
    const inventory = spawnSync("powershell", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress"],
      { encoding: "utf8", timeout: TIMEOUT })
    if (inventory.status !== 0) throw new Error(`termination inventory failed: ${inventory.error ?? inventory.stderr}`)
    const live = new Set([JSON.parse(inventory.stdout)].flat())
    const remainingPids = [...ownedPids].filter(pid => pid !== process.pid && live.has(pid))
    if (remainingPids.length > 0) throw new Error(`taskkill exit ${killCode}; owned processes still alive: ${remainingPids.join(",")}`)
    return { ...result, taskkillExitCode: killCode, remainingPids }
  } else {
    process.kill(-child.pid, "SIGKILL")
  }
  return await exit
}

async function deadline(promise, ms, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

// Windows does not expose O_DIRECTORY/O_NOFOLLOW for the fd-based snapshot.
// Use drive's portable digest with the same scope and explicit finite budgets.
function portableObservation(root) {
  let entries = 0
  let files = 0
  let bytesRead = 0
  const snapshot = new Map()
  try {
    const digest = digestDirectory(root, {
      readdir(path, options) {
        if (["sessions", "cache", "logs"].includes(relative(root, path))) return []
        snapshot.set(relative(root, path).replaceAll("\\", "/") || ".", "directory")
        const found = readdirSync(path, options).filter((entry) =>
          !entry.isSocket() && !(entry.isFile() && entry.name.endsWith(".log")))
        entries += found.length
        if (entries > HOME_LIMITS.maxEntries) throw new Error("HOME_ENTRY_LIMIT")
        return found
      },
      readFile(path) {
        files++
        const size = statSync(path).size
        if (files > HOME_LIMITS.maxFiles || size > HOME_LIMITS.maxBytes - bytesRead) throw new Error("HOME_FILE_OR_BYTE_LIMIT")
        bytesRead += size
        const bytes = readFileSync(path)
        snapshot.set(relative(root, path).replaceAll("\\", "/"), createHash("sha256").update(bytes).digest("hex"))
        return bytes
      },
    })
    if (digest === "absent") snapshot.set(".", "absent")
    return { snapshot, complete: true, truncated: false, errors: [], bytesRead }
  } catch (error) {
    return { snapshot: new Map(), complete: false, truncated: true, errors: [{ path: ".", code: String(error) }], bytesRead }
  }
}

function observeHome(path) {
  return process.platform === "win32" ? portableObservation(path) : snapshotDirectory(path, HOME_LIMITS)
}

function protectedHome(path) {
  // Windows has no O_NOFOLLOW. The shared reader still rejects non-files and
  // verifies lstat/opened-fstat/finished-fstat/lstat identity before accepting data.
  return process.platform === "win32"
    ? snapshotProtectedState(path, { noFollowReadFlags: constants.O_RDONLY })
    : snapshotProtectedState(path)
}

function smallJson(file) {
  try {
    const metadata = statSync(file)
    if (!metadata.isFile() || metadata.size > 1024 * 1024) return undefined
    return JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error instanceof SyntaxError) return undefined
    throw error
  }
}

function fieldDigests(value) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, field]) =>
    [key, createHash("sha256").update(JSON.stringify(field)).digest("hex")]))
}

function ownedReferences(value, sandbox, ownedPids) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {})
  const sandboxReferenced = text.replaceAll("\\\\", "/").includes(sandbox.root.replaceAll("\\", "/")) ||
    text.includes(sandbox.root.split(/[\\/]/u).at(-1))
  const pidReferenced = [...ownedPids].some((pid) =>
    new RegExp(`"(?:pid|ppid|parentPid|childPid|processId|ProcessId)"\\s*:\\s*"?${pid}\\b`, "u").test(text))
  return sandboxReferenced || pidReferenced
}

function peerMarkers(root) {
  const dir = join(root, "process-crashes/live")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => /^\d+\.json$/u.test(name)).flatMap((name) => {
    const record = smallJson(join(dir, name))
    return record?.pid === Number(name.slice(0, -5)) ? [{ pid: record.pid, kind: record.kind }] : []
  })
}

function collectOwnedPids(pid) {
  const windows = process.platform === "win32"
  const result = spawnSync(windows ? "powershell.exe" : "ps", windows
    ? ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"]
    : ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 5000 })
  if (result.status !== 0) throw new Error(`process ownership scan failed: ${result.error ?? result.stderr}`)
  const rows = windows
    ? [JSON.parse(result.stdout)].flat().map((row) => [row.ProcessId, row.ParentProcessId])
    : result.stdout.trim().split(/\r?\n/u).map((line) => line.trim().split(/\s+/u).map(Number))
  const owned = new Set([process.pid, pid])
  let size
  do {
    size = owned.size
    for (const [child, parent] of rows) if (owned.has(parent)) owned.add(child)
  } while (owned.size !== size)
  return owned
}

function openFileOwners(file) {
  if (process.platform === "win32" || !existsSync(file)) return []
  const result = spawnSync(process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof",
    ["-t", "--", file], { encoding: "utf8", timeout: 5000 })
  if (result.status !== 0) return []
  return result.stdout.trim().split(/\s+/u).map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0)
}

function homeBefore(sandbox, ownedPids) {
  return [".senpi", ".omo"].map((name) => {
    const path = join(homedir(), name, "agent")
    const record = {
      path, versions: new Map(), references: new Set(), captureErrors: [],
      peers: peerMarkers(path), runtimeMarkers: new Map(),
      gatewayOwners: openFileOwners(join(path, "gateway/gateway.sqlite")),
      protected: protectedHome(path), credentials: credentialDigest(path),
    }
    const capture = (rel) => {
      const normalized = rel.replaceAll("\\", "/")
      try {
        const data = smallJson(join(path, rel))
        if (data === undefined) return
        if (ownedReferences(data, sandbox, ownedPids)) record.references.add(normalized)
        if (normalized === "settings.json") {
          const versions = record.versions.get(normalized) ?? []
          versions.push(fieldDigests(data))
          record.versions.set(normalized, versions)
        }
        if (/^runtime\/[^/]+\/runtime-snapshot\.json$/u.test(normalized))
          record.runtimeMarkers.set(normalized, { buildId: data.buildId, installPackageDir: data.installPackageDir })
      } catch (error) { record.captureErrors.push({ path: normalized, error: String(error) }) }
    }
    capture("settings.json")
    const runtimeDir = join(path, "runtime")
    if (existsSync(runtimeDir)) for (const entry of readdirSync(runtimeDir))
      capture(`runtime/${entry}/runtime-snapshot.json`)
    if (existsSync(path)) {
      record.watcher = watch(path, { recursive: true }, (_event, file) => {
        if (file && String(file).endsWith(".json")) capture(String(file))
      })
      record.watcher.on("error", (error) => record.captureErrors.push({ error: String(error) }))
    }
    record.capture = capture
    record.observed = observeHome(path)
    return record
  })
}

function attributeChange(path, record, sandbox, ownedPids, peers) {
  const current = smallJson(join(record.path, path))
  let raw
  const file = join(record.path, path)
  if (/^gateway\/gateway\.sqlite(?:-(?:wal|shm))?$/u.test(path) && existsSync(file)) {
    if (statSync(file).size > 1024 * 1024) return { path, attribution: "unattributed", reason: "reference_scan_limit" }
    raw = readFileSync(file, "utf8")
  }
  const markerPid = /^process-crashes\/live\/(\d+)\.json$/u.exec(path)?.[1]
  if (record.references.has(path) || ownedReferences(current, sandbox, ownedPids) ||
    (raw && ownedReferences(raw, sandbox, ownedPids)) ||
    (markerPid && ownedPids.has(Number(markerPid)))) return { path, attribution: "driver_owned" }
  if (/^gateway\/gateway\.sqlite(?:-(?:wal|shm))?$/u.test(path)) {
    const owners = [...new Set([...(record.gatewayOwners ?? []), ...openFileOwners(join(record.path, "gateway/gateway.sqlite"))])]
    if (owners.some((pid) => ownedPids.has(pid))) return { path, attribution: "driver_owned", owning_pids: owners }
    if (owners.length > 0) return { path, attribution: "external_writer", owning_pids: owners, source: "open_database_fd_owners" }
  }
  if (markerPid) return { path, attribution: "external_writer", owning_pid: Number(markerPid), source: "process_lifetime_marker" }
  const runtimeId = /^runtime\/([^/]+)\/runtime-snapshot\.json$/u.exec(path)?.[1]
  const marker = record.runtimeMarkers.get(path)
  if (runtimeId && marker?.buildId && runtimeId.startsWith(marker.buildId) &&
    typeof marker.installPackageDir === "string")
    return { path, attribution: "external_writer", runtime_id: runtimeId, build_id: marker.buildId, source: "installed_runtime_snapshot" }
  if (path === "settings.json" && peers.length > 0) {
    const versions = record.versions.get(path) ?? []
    const fields = new Set()
    for (let i = 1; i < versions.length; i++) for (const key of new Set([...Object.keys(versions[i - 1]), ...Object.keys(versions[i])]))
      if (versions[i - 1][key] !== versions[i][key]) fields.add(key)
    if (versions.length > 0 && [...fields].every((field) => field === "tipsHistory"))
      return { path, attribution: "external_writer", owning_pid_candidates: peers.map((peer) => peer.pid),
        changed_fields: [...fields], source: "peer_settings_tips_history", ownership: "candidate set; exact writer not recorded by settings format" }
  }
  return { path, attribution: "unattributed" }
}

function homeAfter(before, sandbox, ownedPids) {
  return before.map((record) => {
    const after = protectedHome(record.path)
    const observed = observeHome(record.path)
    record.capture("settings.json")
    record.watcher?.close()
    const observedChangedPaths = changedSnapshotPaths(record.observed.snapshot, observed.snapshot)
    // Live RPC sockets are IPC endpoints, not persisted agent files. Keep the
    // helper's findings visible and exclude only positively identified sockets.
    const errors = [...record.observed.errors, ...observed.errors]
    const excludedSockets = errors.filter((error) => error.code === "UNSUPPORTED_ENTRY" &&
      existsSync(join(record.path, error.path)) && lstatSync(join(record.path, error.path)).isSocket())
    const peers = [...new Map([...record.peers, ...peerMarkers(record.path)].filter((peer) => !ownedPids.has(peer.pid))
      .map((peer) => [peer.pid, peer])).values()]
    const candidates = [...new Set([...observedChangedPaths,
      ...changedSnapshotPaths(record.protected.snapshot, after.snapshot),
      ...errors.filter((error) => !excludedSockets.includes(error)).map((error) => error.path)])]
    const attribution = candidates.map((path) => attributeChange(path, record, sandbox, ownedPids, peers))
    const external = attribution.filter((entry) => entry.attribution === "external_writer")
    const internal = attribution.filter((entry) => entry.attribution !== "external_writer")
    const externalPaths = new Set(external.map((entry) => entry.path))
    const fileObservationComplete = !record.observed.truncated && !observed.truncated &&
      errors.every((error) => excludedSockets.includes(error) || externalPaths.has(error.path)) &&
      record.captureErrors.length === 0
    return {
      path: record.path,
      protectedReadMethod: process.platform === "win32" ? "readonly-descriptor-stable-file-identity" : "nofollow-descriptor",
      protectedUntouched: protectedSnapshotsUntouched(record.protected, after),
      protectedErrors: [...record.protected.errors, ...after.errors],
      changedPaths: changedSnapshotPaths(record.protected.snapshot, after.snapshot),
      credentialsUntouched: record.credentials === credentialDigest(record.path),
      nonvolatileUntouched: fileObservationComplete && observedChangedPaths.length === 0,
      noDriverOwnedChanges: fileObservationComplete && internal.length === 0,
      external_writer: external,
      driver_owned_or_unattributed: internal,
      captureErrors: record.captureErrors,
      observedChangedPaths,
      observationComplete: record.observed.complete && observed.complete,
      observationTruncated: record.observed.truncated || observed.truncated,
      observationBytesRead: record.observed.bytesRead + observed.bytesRead,
      observationLimits: HOME_LIMITS,
      observationErrors: errors,
      fileObservationComplete,
      excludedSockets: [...new Set(excludedSockets.map((error) => error.path))],
      observationScope: "protected files and bounded nonvolatile snapshot; excludes sessions/cache/logs and identified IPC sockets",
    }
  })
}

function check(name, condition, details) {
  return { name, result: condition ? "PASS" : "FAIL", ...(details === undefined ? {} : { details }) }
}

function isFailedCompaction(entry) {
  return (entry.type === "session_compact_failed" && entry.payload.aborted !== true) ||
    (entry.type === "session_compact" && entry.payload.accepted === false && FAILED_REJECTIONS.has(entry.payload.rejectionCause))
}

function analyze(scenario, sandbox, router, requestLog) {
  const enabled = scenario === "compaction-failure"
  const sessions = sessionsIn(sandbox.sessionsDir)
  const handoffs = allFiles(join(sandbox.cwd, ".omo/handoffs"), ".md")
  const old = sessions.find((session) => users(session.entries).some((entry) => messageText(entry.message).includes(INITIAL)))
  const fresh = sessions.find((session) => messageText(users(session.entries)[0]?.message).includes(SEED))
  const customCount = sessions.reduce((count, session) => count + requests(session.entries).length, 0)
  const logs = readEntries(requestLog)
  const seedRequests = logs.filter((row) => row.lane === "agent" &&
    row.body.messages.filter((message) => message.role === "user").length === 1 &&
    messageText(row.body?.messages?.find((message) => message.role === "user")).includes(SEED))
  const initialUsage = old?.entries.find((entry) => entry.message?.role === "assistant")?.message?.usage?.input
  const firstRequestUser = logs[0]?.body?.messages?.find((message) => message.role === "user")
  const checks = [
    check("initial_request_contains_three_facts", messageText(firstRequestUser).includes(INITIAL) && hasFacts(messageText(firstRequestUser))),
    check("reported_usage_crosses_threshold", initialUsage >= 10000, { input: initialUsage, contextWindow: 200000, thresholdPercent: 5 }),
  ]
  if (enabled) {
    const oldHeader = old?.entries.find((entry) => entry.type === "session")
    const newHeader = fresh?.entries.find((entry) => entry.type === "session")
    const seed = messageText(users(fresh?.entries ?? [])[0]?.message)
    checks.push(
      check("handoff_file_exact_path_and_three_facts", handoffs.length === 1 && handoffs[0] === router.handoffPath &&
        router.handoffPath === join(sandbox.cwd, ".omo/handoffs", `${oldHeader?.id}.md`) &&
        hasFacts(readFileSync(handoffs[0], "utf8"))),
      check("automatic_fallback_preserves_parent", handoffs.length === 1 &&
        readFileSync(handoffs[0], "utf8").includes(old?.file) &&
        old?.entries.some((entry) => entry.message?.stopReason === "error" && entry.message.errorMessage?.includes(HANDOFF_ERROR)) === true),
      check("new_session_first_user_seed_and_parent", sessions.length === 2 && Boolean(oldHeader?.id) &&
        Boolean(newHeader?.id) && newHeader.id !== oldHeader.id && newHeader.parentSession === old.file &&
        hasFacts(seed) && seed.includes(old.file), { oldId: oldHeader?.id, newId: newHeader?.id, parentSession: newHeader?.parentSession }),
      check("old_session_exactly_one_visible_request", customCount === 1 && requests(old?.entries ?? []).length === 1 &&
        requests(old?.entries ?? [])[0]?.display === true, { customCount }),
      check("provider_first_user_is_seed", seedRequests.length === 1 &&
        seedRequests[0].body.messages.filter((message) => message.role === "user").length === 1 &&
        hasFacts(messageText(seedRequests[0].body.messages.find((message) => message.role === "user")))),
      check("fresh_session_answered_seed", fresh?.entries.some((entry) => entry.message?.role === "assistant" && messageText(entry.message) === RESUMED) === true),
      check("fresh_high_usage_no_second_request", requests(fresh?.entries ?? []).length === 0 &&
        fresh?.entries.some((entry) => entry.message?.role === "assistant" &&
          entry.message.usage?.input >= 10000) === true),
      check("exactly_two_sessions", sessions.length === 2, { count: sessions.length }),
    )
  } else {
    checks.push(check("no_handoff_file", handoffs.length === 0),
      check("no_request_or_seed", customCount === 0 && seedRequests.length === 0 &&
        !logs.some((row) => JSON.stringify(row.body.messages).includes("<omo-context-handoff>"))),
      check("only_one_session", sessions.length === 1))
  }
  return { checks, sessions: sessions.map(({ file }) => file), handoffs }
}

async function scenario(name, command, evidenceRoot) {
  console.log(`WORKING: ${name}`)
  const enabled = name !== "disabled-control"
  const evidence = join(evidenceRoot, name)
  mkdirSync(evidence, { recursive: true })
  const sandbox = createSeededSandbox()
  sandbox.sessionsDir = join(sandbox.agentDir, "sessions")
  mkdirSync(sandbox.sessionsDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  const nativeState = join(sandbox.agentDir, "omo-senpi/omo-native")
  mkdirSync(nativeState, { recursive: true })
  writeFileSync(join(nativeState, "onboarding-completed"), JSON.stringify({ completedAt: new Date().toISOString(), version: 1 }))
  const config = { context_handoff: {
    enabled, threshold_percent: 5, compaction_repeat_limit: 3, compaction_repeat_window_minutes: 10,
  } }
  writeFileSync(join(sandbox.cwd, ".omo/omo.json"), JSON.stringify(config))
  const requestLog = join(evidence, "provider-requests.jsonl")
  writeFileSync(requestLog, "")
  const router = mockRouter(requestLog, name)
  const trace = installObserver(sandbox)
  const server = startMockCompletionsServer({ steps: router.steps })
  let session
  const result = { scenario: name, mode: "rpc", sandboxAgentDir: sandbox.agentDir, checks: [] }
  const ownedPids = new Set([process.pid])
  const homes = homeBefore(sandbox, ownedPids)
  try {
    const baseUrl = await deadline(server.ready, 10000, "mock server startup")
    writeFileSync(join(sandbox.agentDir, "auth.json"), JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }))
    const settingsFile = join(sandbox.agentDir, "settings.json")
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"))
    settings.compaction = { enabled: true, reserveTokens: 20000, keepRecentTokens: 0 }
    writeFileSync(settingsFile, JSON.stringify(settings))
    writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({ providers: {
      "omo-mock": { api: "openai-completions", baseUrl, apiKey: "mock", models: [{
        id: "mock-1", name: "Context handoff QA", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096,
      }] },
    } }))
    const env = {
      ...isolatedChildEnv(process.env, sandbox.agentDir),
      HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome,
      XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
      PI_OFFLINE: "1", OMO_SENPI_QA: "1",
    }
    for (const name of ["SENPI_BIN", "SENPI_PACKAGE_DIR", "OMO_PACKAGE_DIR", "PI_PACKAGE_DIR"]) delete env[name]
    session = launch(command, sandbox, env, evidence)
    ownedPids.add(session.child.pid)
    result.childPid = session.child.pid
    result.command = session.command
    const state = await session.request("get_state")
    result.initialState = state
    const compact = async (customInstructions) => {
      router.setCompacting(true)
      try { return await session.request("compact", { customInstructions }, true) }
      finally { router.setCompacting(false) }
    }
    await session.request("set_auto_retry", { enabled: false })
    await session.turn(`${INITIAL}\nRemember these unique facts:\n${FACTS.join("\n")}`, INITIAL)
    await session.turn(PREPARE)
    result.beforeCompaction = await session.request("get_state")
    result.checks.push(check("high_usage_alone_does_not_handoff",
      result.beforeCompaction.contextUsage?.percent >= 5 &&
      sessionsIn(sandbox.sessionsDir).length === 1 &&
      sessionsIn(sandbox.sessionsDir).every((session) => requests(session.entries).length === 0)))
    result.compactionResponse = await compact("Keep the three FACT tokens and the next QA action.")
    result.afterCompaction = await session.request("get_state")
    const hostEvents = readEntries(trace)
    const compactions = hostEvents.filter((entry) => entry.type === "session_compact")
    const failed = hostEvents.filter((entry) => entry.type === "session_compact_failed" && entry.payload.aborted !== true)
    const summaryRequests = readEntries(requestLog).filter((row) => row.lane === "compaction")
    result.checks.push(check("real_summary_request_observed", summaryRequests.length > 0))
    if (name === "healthy-compaction") {
      result.checks.push(check("healthy_compaction_accepted_and_usage_drops",
        result.compactionResponse.success === true && compactions.some((entry) => entry.payload.accepted === true) &&
        failed.length === 0 && result.afterCompaction.contextUsage?.percent < 5, result.afterCompaction.contextUsage))
      await session.turn(POST_COMPACT)
    } else {
      result.checks.push(check("real_compaction_failure_observed",
        result.compactionResponse.success === false && hostEvents.some(isFailedCompaction),
        hostEvents.filter(isFailedCompaction).map((entry) => entry.payload)))
      if (name === "compaction-failure") {
        // The failure is consumed by the next settled run. The handoff request's
        // own provider error must make production omo write the fallback.
        const from = session.events.length
        const resumed = session.wait((event) => event.type === "agent_end" &&
          event.messages?.some((message) => message.role === "assistant" && messageText(message) === RESUMED), "fresh seed answer", from)
        const acknowledged = session.request("prompt", { message: POST_COMPACT })
        const [ended] = await Promise.all([resumed, acknowledged])
        await session.wait((event) => event.type === "agent_idle", "fresh session idle", session.events.indexOf(ended) + 1)
        result.seedState = await session.request("get_state")
        // A second real compaction failure in the still-high seeded session must
        // be swallowed by the loop guard, not launch a third session.
        const beforeGuard = readEntries(trace).length
        result.loopCompactionResponse = await compact("Keep all FACT tokens.")
        await session.turn(LOOP_PROBE)
        result.checks.push(check("loop_guard_exercised_by_real_failure",
          result.loopCompactionResponse.success === false &&
          readEntries(trace).slice(beforeGuard).some(isFailedCompaction)))
        const handoffEvents = readEntries(trace).filter((entry) =>
          entry.type === "message_start" && entry.payload.message?.customType === REQUEST_TYPE)
        result.checks.push(check("handoff_never_during_compaction",
          handoffEvents.length === 1 && handoffEvents.every((entry) => entry.isCompacting === false)))
      } else {
        await session.turn(POST_COMPACT)
      }
    }
    result.finalState = await session.request("get_state")
    const priorChecks = result.checks
    Object.assign(result, analyze(name, sandbox, router, requestLog))
    result.checks = [...priorChecks, ...result.checks]
    result.checks.push(check("final_session_idle", result.finalState.isStreaming === false))
    if (name === "compaction-failure") result.checks.push(check("fresh_context_remains_above_threshold",
      result.finalState.contextUsage?.percent >= 5, result.finalState.contextUsage))
    result.checks.push(check("rpc_session_replaced", name === "compaction-failure"
      ? session.events.some((event) => event.type === "session_replaced")
      : !session.events.some((event) => event.type === "session_replaced")))
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.checks.push(check("live_flow_completed", false, result.error))
    Object.assign(result, { observed: analyze(name, sandbox, router, requestLog) })
  } finally {
    if (session) {
      try {
        for (const pid of collectOwnedPids(session.child.pid)) ownedPids.add(pid)
        result.ownedPids = [...ownedPids]
        result.checks.push(check("owned_pid_scan", true))
      } catch (error) { result.checks.push(check("owned_pid_scan", false, String(error))) }
      try {
        result.cleanup = await stop(session, ownedPids)
        result.checks.push(check("process_tree_cleanup", true))
      } catch (error) { result.checks.push(check("process_tree_cleanup", false, String(error))) }
      result.eventTypes = session.events.map((event) => event.type)
    }
    server.close()
    const receiptPath = join(sandbox.cwd, ".omo-senpi-qa-environment.json")
    const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : undefined
    result.environmentReceipt = receipt
    const identityFile = join(sandbox.cwd, "child-identity.json")
    if (existsSync(identityFile)) {
      const identity = JSON.parse(readFileSync(identityFile, "utf8"))
      result.childIdentity = identity
      result.checks.push(check("all_three_child_agent_dirs_isolated",
        ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"].every((lane) => identity.env[lane] === sandbox.agentDir)))
    } else result.checks.push(check("all_three_child_agent_dirs_isolated", false))
    result.checks.push(check("child_environment_isolated", receipt !== undefined &&
      receipt.HOME === sandbox.homeDir && receipt.USERPROFILE === sandbox.homeDir &&
      receipt.XDG_CONFIG_HOME === sandbox.xdgConfigHome &&
      receipt.XDG_DATA_HOME === sandbox.xdgDataHome &&
      receipt.XDG_CACHE_HOME === sandbox.xdgCacheHome &&
      receipt.SENPI_CODING_AGENT_DIR === sandbox.agentDir))
    result.homes = homeAfter(homes, sandbox, ownedPids)
    result.checks.push(check("real_agent_state_untouched", result.homes.every((home) =>
      home.protectedUntouched && home.credentialsUntouched && home.noDriverOwnedChanges), result.homes))
    // Preserve transcripts and config before deleting only our own sandbox.
    cpSync(sandbox.sessionsDir, join(evidence, "sessions"), { recursive: true })
    if (existsSync(trace)) cpSync(trace, join(evidence, "host-events.jsonl"))
    if (existsSync(join(sandbox.cwd, ".omo/handoffs"))) cpSync(join(sandbox.cwd, ".omo/handoffs"), join(evidence, "handoffs"), { recursive: true })
    writeFileSync(join(evidence, "config.json"), JSON.stringify(config, null, 2))
    rmSync(sandbox.root, { recursive: true, force: true })
    result.checks.push(check("sandbox_removed", !existsSync(sandbox.root)))
  }
  result.result = result.checks.every((check) => check.result === "PASS") ? "PASS" : "FAIL"
  writeFileSync(join(evidence, "verdict.json"), JSON.stringify(result, null, 2))
  return result
}

async function selfTest(evidenceDir) {
  console.log("WORKING: self-test")
  const sandbox = createSeededSandbox()
  try {
    // The shared seeder needs every fixture directory before writing its settings.
    for (const path of [sandbox.cwd, sandbox.agentDir, sandbox.homeDir,
      sandbox.xdgConfigHome, sandbox.xdgDataHome, sandbox.xdgCacheHome])
      assert.ok(statSync(path).isDirectory())
    assert.deepEqual(JSON.parse(readFileSync(join(sandbox.agentDir, "settings.json"), "utf8")).packages,
      [join(repoRoot, "packages/omo-senpi/plugin")])
    assert.equal(JSON.parse(readFileSync(join(sandbox.agentDir, "trust.json"), "utf8"))[sandbox.canonicalCwd], true)
    assert.equal(smallJson(sandbox.agentDir), undefined)
    // Subscribe before terminating a real idle child; no timing-based readiness.
    const child = spawn(process.execPath, ["-e", 'process.stdout.write("ready"); process.stdin.on("data", () => {})'], {
      cwd: sandbox.cwd, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    })
    const exited = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })))
    await deadline(new Promise((done, reject) => {
      child.once("error", reject)
      child.stdout.once("data", done)
    }), TIMEOUT, "cleanup child ready")
    const terminated = await stop({ child, exited })
    assert.ok(terminated.code !== null || terminated.signal !== null)
    const protectedBefore = protectedHome(sandbox.agentDir)
    assert.ok(protectedBefore.complete)
    const protectedFile = join(sandbox.agentDir, "auth.json")
    writeFileSync(protectedFile, '{"qa":1}')
    const protectedAfter = protectedHome(sandbox.agentDir)
    assert.ok(protectedAfter.complete)
    assert.equal(protectedSnapshotsUntouched(protectedBefore, protectedAfter), false)
    assert.ok(changedSnapshotPaths(protectedBefore.snapshot, protectedAfter.snapshot).includes("auth.json"))
    rmSync(protectedFile)
    mkdirSync(protectedFile)
    assert.ok(protectedHome(sandbox.agentDir).errors.some(error => error.path === "auth.json" && error.code === "UNSUPPORTED_ENTRY"))
    rmSync(protectedFile, { recursive: true })
    // Given an isolated fixture, when env is constructed, then all routing lanes are isolated.
    const env = isolatedChildEnv({ OMO_RPC_SOCKET: "real", PI_SESSION_ID: "real" }, sandbox.agentDir)
    for (const lane of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) assert.equal(env[lane], sandbox.agentDir)
    assert.equal(env.OMO_RPC_SOCKET, undefined)
    assert.equal(env.PI_SESSION_ID, undefined)
    // Given persisted state, when changed, then the portable Windows digest detects it.
    const stateFile = join(sandbox.agentDir, "qa-state.json")
    const beforeState = portableObservation(sandbox.agentDir)
    writeFileSync(stateFile, "{}")
    const afterState = portableObservation(sandbox.agentDir)
    assert.ok(beforeState.complete && afterState.complete)
    assert.notDeepEqual(beforeState.snapshot, afterState.snapshot)
    // Given machine-readable paths, when parsed, then whitespace and separators survive.
    for (const path of [join(sandbox.cwd, ".omo/handoffs/old.md"), "C:\\QA project\\.omo\\handoffs\\old.md"]) {
      assert.equal(handoffPathFrom({ messages: [{ role: "user", content: `<omo-context-handoff>\n${path}\n</omo-context-handoff>` }] }), path)
    }
    assert.throws(() => handoffPathFrom({ messages: [] }))
    // Given a missing signal, when subscribed, then its bounded deadline rejects.
    await assert.rejects(watchUntil(sandbox.cwd, () => false, { timeoutMs: 1, description: "negative control" }), /timed out/u)
    // Given an armed watcher, when a file is created, then the actual event resolves it.
    // Do not reuse the just-closed negative watcher root: native macOS watcher
    // teardown is asynchronous. This signal has its own directory and watcher.
    const signalDir = join(sandbox.cwd, "signal-dir")
    mkdirSync(signalDir)
    const signal = join(signalDir, "signal")
    const changed = watchUntil(signalDir, () => existsSync(signal), { timeoutMs: TIMEOUT, description: "file signal" })
    writeFileSync(signal, "ready")
    await changed
    // Given garbage summary output and a failing handoff request, when routed,
    // then the wire supplies the bad summary and error without fake host events.
    const router = mockRouter(join(sandbox.cwd, "requests.jsonl"), "compaction-failure")
    const server = startMockCompletionsServer({ steps: router.steps })
    try {
      const base = await server.ready
      const post = async (messages, tools = [{ type: "function", function: { name: "write" } }]) => {
        const response = await fetch(base, { method: "POST", body: JSON.stringify({ messages, tools }), signal: AbortSignal.timeout(TIMEOUT) })
        return { status: response.status, text: await response.text() }
      }
      assert.match((await post([{ role: "user", content: `${INITIAL}\n${FACTS.join("\n")}` }])).text, /"prompt_tokens":40000/u)
      router.setCompacting(true)
      const summary = await post([{ role: "user", content: FACTS.join("\n") }])
      router.setCompacting(false)
      assert.equal(summary.status, 200)
      assert.ok(summary.text.includes(SUMMARY_OVERFLOW_MARKER))
      assert.ok(summary.text.length > 200000 * 4)
      const path = join(sandbox.cwd, ".omo/handoffs/old.md")
      const handoff = await post([{ role: "user", content: `<omo-context-handoff>\n${path}` }])
      assert.equal(handoff.status, 400)
      assert.equal(JSON.parse(handoff.text).error.message, HANDOFF_ERROR)
      assert.match((await post([{ role: "user", content: `${SEED}\n${FACTS.join("\n")}` }])).text, new RegExp(RESUMED))
    } finally { server.close() }
    const healthy = mockRouter(join(sandbox.cwd, "healthy-requests.jsonl"), "healthy-compaction")
    const healthyServer = startMockCompletionsServer({ steps: healthy.steps })
    try {
      const base = await healthyServer.ready
      healthy.setCompacting(true)
      const response = await fetch(base, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: FACTS.join("\n") }], tools: [{ type: "function", function: { name: "write" } }] }), signal: AbortSignal.timeout(TIMEOUT) })
      assert.equal(response.status, 200)
      assert.ok(hasFacts(await response.text()))
    } finally { healthyServer.close() }
    // Given complete transcript fixtures, when a required fact is removed, then
    // the verdict checker must fail. This tests the driver, not the feature.
    sandbox.sessionsDir = join(sandbox.agentDir, "sessions")
    mkdirSync(sandbox.sessionsDir, { recursive: true })
    mkdirSync(join(sandbox.cwd, ".omo/handoffs"), { recursive: true })
    const oldFile = join(sandbox.sessionsDir, "old.jsonl")
    const freshFile = join(sandbox.sessionsDir, "fresh.jsonl")
    const handoffPath = join(sandbox.cwd, ".omo/handoffs/old.md")
    const save = (file, entries) => writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)
    const user = (text) => ({ type: "message", message: { role: "user", content: text } })
    const assistant = (text) => ({ type: "message", message: { role: "assistant", content: text, usage: { input: 40000 } } })
    save(oldFile, [{ type: "session", id: "old" }, user(`${INITIAL}\n${FACTS.join("\n")}`),
      assistant(INITIAL), { type: "custom_message", customType: REQUEST_TYPE, display: true },
      { type: "message", message: { role: "assistant", stopReason: "error", errorMessage: HANDOFF_ERROR, content: [] } }])
    const freshEntries = [{ type: "session", id: "fresh", parentSession: oldFile },
      user(`${SEED}\n${FACTS.join("\n")}\n${oldFile}`), assistant(RESUMED)]
    save(freshFile, freshEntries)
    writeFileSync(handoffPath, `${FACTS.join("\n")}\n${oldFile}`)
    const analyzeFixture = () => analyze("compaction-failure", sandbox, { handoffPath }, join(sandbox.cwd, "requests.jsonl"))
    assert.ok(analyzeFixture().checks.every((check) => check.result === "PASS"))
    writeFileSync(handoffPath, FACTS.slice(1).join("\n"))
    assert.equal(analyzeFixture().checks.find((check) => check.name === "handoff_file_exact_path_and_three_facts").result, "FAIL")
    freshEntries[0].parentSession = "wrong-parent"
    save(freshFile, freshEntries)
    assert.equal(analyzeFixture().checks.find((check) => check.name === "new_session_first_user_seed_and_parent").result, "FAIL")
    freshEntries.push({ type: "custom_message", customType: REQUEST_TYPE, display: true })
    save(freshFile, freshEntries)
    assert.equal(analyzeFixture().checks.find((check) => check.name === "fresh_high_usage_no_second_request").result, "FAIL")
    // Given unrelated peer telemetry, when attributed, then it is external; a
    // sandbox or child PID reference always overrides the external filename.
    const fakeRecord = {
      path: sandbox.agentDir, references: new Set(), runtimeMarkers: new Map([
        ["runtime/build-peer/runtime-snapshot.json", { buildId: "build", installPackageDir: "/installed/senpi" }],
      ]), versions: new Map([["settings.json", [fieldDigests({ tipsHistory: {} }), fieldDigests({ tipsHistory: { tip: 1 } })]]]),
    }
    const owned = new Set([12345])
    const peers = [{ pid: 54321, kind: "interactive" }]
    assert.equal(attributeChange("process-crashes/live/54321.json", fakeRecord, sandbox, owned, peers).attribution, "external_writer")
    assert.equal(attributeChange("process-crashes/live/12345.json", fakeRecord, sandbox, owned, peers).attribution, "driver_owned")
    assert.equal(attributeChange("runtime/build-peer/runtime-snapshot.json", fakeRecord, sandbox, owned, peers).attribution, "external_writer")
    assert.equal(attributeChange("settings.json", fakeRecord, sandbox, owned, peers).attribution, "external_writer")
    fakeRecord.references.add("settings.json")
    assert.equal(attributeChange("settings.json", fakeRecord, sandbox, owned, peers).attribution, "driver_owned")
    assert.equal(attributeChange("unowned.json", fakeRecord, sandbox, owned, peers).attribution, "unattributed")
    assert.ok(ownedReferences({ cwd: sandbox.cwd }, sandbox, owned))
    assert.ok(ownedReferences({ pid: 12345 }, sandbox, owned))
    assert.equal(ownedReferences({ pid: 54321 }, sandbox, owned), false)
    assert.ok(isFailedCompaction({ type: "session_compact", payload: { accepted: false, rejectionCause: "would-overflow" } }))
    assert.equal(isFailedCompaction({ type: "session_compact", payload: { accepted: false, rejectionCause: "cancelled-by-extension" } }), false)
    const verdict = { result: "PASS", selfTest: true, checks: ["native-sandbox-directories", "native-process-tree-cleanup", "protected-file-identity", "isolated-env", "portable-state-digest", "path-parser", "bounded-deadline", "file-event", "wire-summary-overflow", "verdict-negative-controls", "writer-attribution"] }
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, "self-test.json"), JSON.stringify(verdict, null, 2))
    }
    console.log(JSON.stringify(verdict))
  } finally { rmSync(sandbox.root, { recursive: true, force: true }) }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) return await selfTest(options.evidenceDir)
  mkdirSync(options.evidenceDir, { recursive: true })
  const command = resolveCli()
  const scenarios = []
  const runDir = join(options.evidenceDir, `run-${new Date().toISOString().replace(/[:.]/gu, "-")}`)
  mkdirSync(runDir, { recursive: true })
  // Keep both controls' evidence available before attempting the failing context.
  for (const name of ["healthy-compaction", "disabled-control", "compaction-failure"]) scenarios.push(await scenario(name, command, runDir))
  const verdict = {
    result: scenarios.every((scenario) => scenario.result === "PASS") ? "PASS" : "FAIL",
    mode: "rpc", binary: command.file, evidenceDir: options.evidenceDir,
    scenarios: scenarios.map((scenario) => ({
      scenario: scenario.scenario, result: scenario.result,
      checks: Object.fromEntries(scenario.checks.map((check) => [check.name, check.result])),
      external_writer: (scenario.homes ?? []).flatMap((home) => home.external_writer.map((writer) => ({ root: home.path, ...writer }))),
      ...(scenario.error ? { error: scenario.error } : {}),
      evidence: join(runDir, scenario.scenario, "verdict.json"),
    })),
  }
  writeFileSync(join(options.evidenceDir, "README.md"), [
    "# Context handoff live QA",
    "",
    "## What was tested",
    `Command: ${process.execPath} ${process.argv.slice(1).map((arg) => JSON.stringify(arg)).join(" ")}`,
    `Binary: ${command.file} ${command.prefix.join(" ")}`,
    "Real Senpi RPC with the built repository plugin and an offline loopback mock provider.",
    "Healthy compaction: high usage alone does not hand off; real compact succeeds and lowers usage, with one session.",
    "Compaction failure: the wire returns an oversized garbage summary, rejected by real Senpi admission; the handoff run errors, so production omo writes its fallback with facts and parent.",
    "A second real compaction failure in the high-usage seeded session exercises the loop guard; only two sessions exist.",
    "Disabled control: the same real compaction rejection with no handoff or request and exactly one session.",
    "",
    "## What was observed",
    ...scenarios.map((scenario) => `${scenario.scenario}: ${scenario.result}. Detailed verdict: ${join(runDir, scenario.scenario, "verdict.json")}`),
    "Each scenario includes raw RPC events, provider request bodies, session JSONL, config and any handoff file.",
    "The detailed verdict records the child's environment receipt, real-home protected-state hashes, bounded snapshots and owned-process cleanup.",
    "",
    "## Why it is enough",
    "The assertions consume persisted session identities, parent links, custom entries, actual provider errors and a production-written fallback file.",
    "The final idle event is awaited before checking the disabled control. No fixed sleeps are used.",
    "",
    "## What was omitted",
    "Only the Mac live run was executed; Windows path parsing and portable isolation are self-tested, not a Windows live run.",
    "Real-home snapshot scope excludes sessions/cache/logs and positively identified IPC sockets, reported explicitly.",
    "Changes referencing the sandbox or owned PIDs fail attribution. Identified peer runtime/crash records and tips-only settings rewrites are recorded as external_writer; unknown changes fail.",
    "Settings format does not record an exact writer PID, so its peer PID candidates are labeled rather than asserted as one proven writer.",
    "No real credentials or auth headers are recorded. No source feature code was changed and no commit was created.",
    "Rebuild the plugin before running against modified feature code. The full package gate was not run for this scoped QA driver.",
    "",
  ].join("\n"))
  writeFileSync(join(options.evidenceDir, "verdict.json"), JSON.stringify(verdict, null, 2))
  console.log(JSON.stringify(verdict, null, 2))
  if (verdict.result !== "PASS") process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
