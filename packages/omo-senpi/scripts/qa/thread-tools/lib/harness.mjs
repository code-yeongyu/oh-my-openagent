/**
 * Shared harness for the cross-surface thread-tool QA scenarios (plan task 13).
 *
 * Design constraints this file exists to satisfy:
 * - ONE harness: scratch dirs, ports, fake model and child tracking come from the
 *   sanctioned senpi QA libs (scripts/qa-app-server/lib/{env,fake-model,cleanup}.mjs),
 *   never from a second invented implementation.
 * - Assertions read TARGET STATE, not logs: transcripts come from the host's
 *   `get_messages` and UI rows come from the desktop projection's shellSnapshot.
 * - Self-cleaning: every spawned child, socket, server and scratch dir is registered
 *   with the cleanup hooks before it can leak.
 *
 * Runtime note: these scripts run under `bun` because they load TypeScript from three
 * checkouts (omo thread components, senpi host sources, desktop orchestration modules)
 * whose relative imports are extensionless. Bare specifiers of the desktop workspace are
 * resolved through `createRequire` anchored at the desktop package, so nothing outside
 * this file needs to know where those node_modules live.
 */
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createConnection } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

export const OMO_ROOT = resolve(here, "..", "..", "..", "..", "..", "..")
export const SENPI_ROOT = process.env.THREAD_QA_SENPI_ROOT ?? "/Users/yeongyu/local-workspaces/senpi-thread-tools"
export const DESKTOP_ROOT = process.env.THREAD_QA_DESKTOP_ROOT ?? "/Users/yeongyu/local-workspaces/omo-desktop-thread-tools"

const SENPI_QA_LIB = join(SENPI_ROOT, "packages", "coding-agent", "scripts", "qa-app-server", "lib")
const SENPI_CLI = join(SENPI_ROOT, "packages", "coding-agent", "src", "cli.ts")
const THREAD_COMPONENTS = join(OMO_ROOT, "packages", "omo-senpi", "src", "components", "thread")

const qaEnv = await import(join(SENPI_QA_LIB, "env.mjs"))
const qaCleanup = await import(join(SENPI_QA_LIB, "cleanup.mjs"))

export const { makeScratch, startFakeModelServer, writeMockModelsJson, hermeticEnv } = qaEnv
export const { installCleanupHooks, cleanupAllAndWait, trackChild, trackCloser, shouldDetachChildren } = qaCleanup

/** Load one thread component module from the omo worktree (no barrel wiring yet). */
export function threadComponent(name) {
  return import(join(THREAD_COMPONENTS, `${name}.ts`))
}

/** Load a desktop module by absolute path; its own bare imports resolve at its location. */
export function desktopModule(relativePath) {
  return import(join(DESKTOP_ROOT, relativePath))
}

const desktopRequire = createRequire(join(DESKTOP_ROOT, "apps", "server", "package.json"))

/** Load a desktop workspace dependency (effect, @effect/platform-node, ...). */
export function desktopDependency(specifier) {
  return import(desktopRequire.resolve(specifier))
}

/* ------------------------------------------------------------------ reporting */

export function createReport(label) {
  const lines = []
  let failures = 0
  return {
    lines,
    log(line) {
      lines.push(line)
      process.stdout.write(`${line}\n`)
    },
    /** Records a named assertion; a false condition marks the whole script failed. */
    assert(name, ok, detail) {
      const status = ok ? "PASS" : "FAIL"
      if (!ok) failures += 1
      this.log(`${status} ${label}/${name}${detail === undefined ? "" : ` ${detail}`}`)
      return ok
    },
    get failures() {
      return failures
    },
    write(outPath) {
      if (outPath === undefined) return
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, `${lines.join("\n")}\n`)
    },
  }
}

export function flag(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

/* ------------------------------------------------------- real senpi socket host */

/**
 * Spawn the REAL senpi multi-session host on a unix socket and wait for its
 * readiness line. The child is tracked before the first await so a failure between
 * spawn and readiness still cleans up.
 */
export async function startRealHost(scratch, { socketPath, extraArgs = [] } = {}) {
  const socket = socketPath ?? join(scratch.dir, "rpc.sock")
  const child = spawn(
    process.execPath,
    [SENPI_CLI, "--mode", "rpc", "--multi-session", "--listen", `unix://${socket}`, ...extraArgs],
    // detached matches spawnCli: the cleanup hooks signal the whole process GROUP, which is
    // the only way a host that re-execs under another runtime is guaranteed to die with us.
    { cwd: scratch.cwd, detached: shouldDetachChildren(), env: scratch.env, stdio: ["pipe", "pipe", "pipe"] },
  )
  trackChild(child)
  const stderr = []
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")))
  await waitForOutput(child, `senpi rpc listening on unix://${socket}`, stderr)
  return { child, pid: child.pid, socket, stderrText: () => stderr.join("") }
}

function waitForOutput(child, needle, stderr, timeoutMs = 60_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = ""
    const timer = setTimeout(() => {
      rejectPromise(new Error(`host did not print "${needle}" within ${timeoutMs}ms:\n${buffer.slice(-2000)}`))
    }, timeoutMs)
    const onChunk = (chunk) => {
      buffer += chunk.toString("utf8")
      if (!buffer.includes(needle)) return
      clearTimeout(timer)
      resolvePromise(buffer)
    }
    child.stderr.on("data", onChunk)
    child.stdout.on("data", onChunk)
    child.once("exit", (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`host exited ${code} before readiness:\n${stderr.join("").slice(-2000)}`))
    })
  })
}

/**
 * Register the host that a DESKTOP-shaped client starts for itself. That host is spawned
 * detached by `ensureOmoSocketHost`, so the QA cleanup hooks never see it; the pid file the
 * desktop writes is the only handle, and this closer is what keeps the run leak-free.
 */
export function trackDesktopManagedHost(agentDir, socketPath) {
  const pidFile = join(agentDir, "rpc-host-daemon", "desktop-host.json")
  // The pid is cached as soon as it is first observed: the scratch tree (pid file included)
  // is removed by an earlier-registered closer, so reading the file at cleanup time is a race
  // this closer must not depend on.
  let cachedPid
  const readPid = () => {
    try {
      const pid = JSON.parse(readFileSync(pidFile, "utf8")).pid
      if (typeof pid === "number") cachedPid = pid
    } catch {
      // Absent or malformed pid file: the desktop client has not started a host yet.
    }
    return cachedPid
  }
  const terminate = (pid) => {
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      try {
        process.kill(pid, signal)
      } catch {
        return
      }
      const deadline = Date.now() + (signal === "SIGTERM" ? 3000 : 2000)
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0)
        } catch {
          return
        }
        Bun.sleepSync(25)
      }
    }
  }
  const stop = () => {
    const pid = readPid()
    if (typeof pid === "number") terminate(pid)
    // Second, independent handle on the same host: its argv carries this run's socket path,
    // which is unique to this scratch dir. This keeps the closer correct even when the pid
    // file was never observed, and it can never match a host from another run or checkout.
    if (socketPath !== undefined) {
      for (const survivor of pgrepPids(socketPath)) terminate(Number(survivor))
    }
  }
  trackCloser(stop)
  return { stop, pid: readPid }
}

/**
 * A senpi CLI shim so a desktop-shaped client can treat this checkout as its omo binary.
 * The file name is `omo` on purpose: OmoSharedProcess treats a binary named `omo` as the
 * launcher and therefore adds no `--extension` argument, which keeps the QA host free of
 * the globally installed omo plugin and its extra turns.
 */
export function writeCliShim(scratch, name = "omo") {
  const path = join(scratch.dir, name)
  writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(SENPI_CLI)} "$@"\n`, {
    mode: 0o755,
  })
  chmodSync(path, 0o755)
  return path
}

/* ----------------------------------------------------------- raw JSONL RPC client */

/**
 * Minimal JSONL client over the host socket. This is the CLI-shaped surface: exactly
 * what a terminal client writes on the wire, with no desktop machinery in the path.
 */
export class HostClient {
  static async connect(socketPath, label) {
    const socket = createConnection(socketPath)
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`connect timeout ${socketPath}`)), 15_000)
      socket.once("connect", () => {
        clearTimeout(timer)
        resolvePromise()
      })
      socket.once("error", (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
    })
    return new HostClient(socket, label)
  }

  constructor(socket, label) {
    this.socket = socket
    this.label = label
    this.records = []
    this.waiters = new Set()
    this.buffer = ""
    this.sequence = 0
    socket.on("data", (chunk) => this.#ingest(chunk.toString("utf8")))
    this.close = () => socket.destroy()
    trackCloser(this.close)
  }

  mark() {
    return this.records.length
  }

  #ingest(text) {
    this.buffer += text
    for (;;) {
      const newline = this.buffer.indexOf("\n")
      if (newline < 0) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length === 0) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      const index = this.records.length
      this.records.push(record)
      for (const waiter of [...this.waiters]) {
        if (index < waiter.from || !waiter.predicate(record)) continue
        clearTimeout(waiter.timer)
        this.waiters.delete(waiter)
        waiter.resolve(record)
      }
    }
  }

  waitFor(predicate, from = 0, timeoutMs = 60_000) {
    for (let index = from; index < this.records.length; index += 1) {
      if (predicate(this.records[index])) return Promise.resolve(this.records[index])
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = {
        predicate,
        from,
        resolve: resolvePromise,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          rejectPromise(new Error(`[${this.label}] timeout waiting for record after ${timeoutMs}ms`))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  /** Send a command and return its response frame, success or typed failure. */
  async raw(command, timeoutMs = 60_000) {
    this.sequence += 1
    const id = `${this.label}-${this.sequence}`
    const from = this.mark()
    this.socket.write(`${JSON.stringify({ id, ...command })}\n`)
    return await this.waitFor((record) => record.type === "response" && record.id === id, from, timeoutMs)
  }

  /** Same as raw(), but a failure response throws (use for steps that must succeed). */
  async request(command, timeoutMs = 60_000) {
    const response = await this.raw(command, timeoutMs)
    if (response.success !== true) {
      throw new Error(`${command.type} failed: ${JSON.stringify(response.error ?? response)}`)
    }
    return response
  }

  async openSession(params) {
    const response = await this.request({ type: "open_session", ...params })
    return { routingId: response.data.sessionId, state: response.data.state }
  }

  async listSessions() {
    const response = await this.request({ type: "list_sessions" })
    return response.data.sessions
  }

  async messages(routingId) {
    const response = await this.request({ type: "get_messages", sessionId: routingId })
    return response.data.messages ?? []
  }

  /** Deliver a prompt and await the target's own settle event, never a timer. */
  async promptAndSettle(routingId, message, options = {}) {
    const from = this.mark()
    await this.request({ type: "prompt", sessionId: routingId, message, ...options })
    await this.waitFor(
      (record) => record.type === "agent_settled" && record.sessionId === routingId,
      from,
      120_000,
    )
  }
}

/* -------------------------------------------------------- transcript assertions */

/** Flatten one host AgentMessage to searchable text regardless of content shape. */
export function messageText(message) {
  if (typeof message?.content === "string") return message.content
  return JSON.stringify(message?.content ?? message ?? {})
}

export function countUserTurns(messages, needle) {
  return messages.filter((message) => message?.role === "user" && messageText(message).includes(needle)).length
}

export function countAssistantTurns(messages, needle) {
  return messages.filter((message) => message?.role === "assistant" && messageText(message).includes(needle)).length
}

/* ----------------------------------------------------------- host-backed helpers */

/**
 * Address-book view of ONE live host, assembled by the shipped components: the host's
 * own list_sessions plus the durable sessions on disk. Nothing here is mocked.
 */
export async function liveAddressBook(client, socketPath, sessionsDir) {
  const { assembleAddressBook, scanDiskSessions, toThreadAddressEntries } = await threadComponent("address-book")
  const listed = await client.request({ type: "list_sessions" })
  const disk = scanDiskSessions(sessionsDir, { source_host: socketPath })
  const entries = assembleAddressBook([{ socket: socketPath, list_sessions: listed.data }], disk)
  return { entries, addressEntries: toThreadAddressEntries(entries) }
}

/** Mailbox port bound to one live host session, used for ordered delivery + steering. */
export function mailboxPortFor(client, routingId) {
  return {
    snapshot: async () => {
      const state = await client.request({ type: "get_state", sessionId: routingId })
      const data = state.data ?? {}
      const active = data.isStreaming === true
      const turnId = typeof data.activeTurnId === "string" ? data.activeTurnId : undefined
      return active && turnId !== undefined ? { active, turn_id: turnId } : { active }
    },
    steer: async (message, _expectedTurnId, _operationId) => {
      await client.request({ type: "prompt", sessionId: routingId, message, streamingBehavior: "steer" })
    },
    start: async (message) => {
      const from = client.mark()
      await client.request({ type: "prompt", sessionId: routingId, message })
      const settled = await client.waitFor(
        (record) => record.type === "agent_settled" && record.sessionId === routingId,
        from,
        120_000,
      )
      return { turn_id: typeof settled.turnId === "string" ? settled.turnId : `turn-${from}` }
    },
  }
}

/* ------------------------------------------------------------- cleanup receipts */

/** Processes whose command line matches `pattern`, as pids. */
export function pgrepPids(pattern) {
  return runCapture("pgrep", ["-f", pattern])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function socketHolders(socketPath) {
  if (!existsSync(socketPath)) return []
  return runCapture("lsof", ["-t", socketPath])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function runCapture(command, args) {
  const result = Bun.spawnSync([command, ...args])
  return result.stdout.toString()
}

/**
 * Post-cleanup verification. Cleanup is only proven when NOTHING matching this run's own
 * scratch path survives and the scratch tree itself is gone - a claim in a log is not proof.
 * Scoping the pgrep pattern to the scratch dir is deliberate: pre-existing hosts from ~/.bun
 * or another checkout are none of this run's business and must be left alone.
 */
export function verifyCleanup(report, { scratchDir, socketPaths = [] }) {
  const survivors = scratchDir === undefined ? [] : pgrepPids(scratchDir)
  const holders = socketPaths.flatMap((path) => socketHolders(path))
  const scratchLeft = scratchDir !== undefined && existsSync(scratchDir)
  report.assert(
    "cleanup-no-leftovers",
    survivors.length === 0 && holders.length === 0 && !scratchLeft,
    `survivor_pids=${JSON.stringify(survivors)} socket_holders=${JSON.stringify(holders)} scratch_present=${scratchLeft}`,
  )
  return { survivors, holders, scratchLeft }
}

export function readTextIfPresent(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

export function removePath(path) {
  rmSync(path, { recursive: true, force: true })
}
