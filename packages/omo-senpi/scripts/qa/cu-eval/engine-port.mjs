// The spawn launcher the eval and the bench inject into the SDK's `spawn` transport: it starts
// `senpi-desktop-engine --stdio`, speaks NDJSON JSON-RPC on its stdio as an `RpcPort`, and runs the host's
// handshake (engine.hello, session.open, stopPath.start, a 500 ms stopPath.heartbeat). Every reply passes
// `onReply(method, result, wallMs)`, which is how the bench reads `ActionReport.timings` (row 11) before the
// SDK parses the report.
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

import { withTelemetryOptOut } from "../telemetry-opt-out-env.mjs"

/** The stop chord the eval arms; the host relay heartbeat below keeps the stop path live. */
const STOP_CHORD = "ctrl+alt+shift+escape"
/** Same cadence as the desktop service (`HEARTBEAT_MS`). */
const HEARTBEAT_MS = 500
const CLOSE_GRACE_MS = 3_000

/** An `RpcPort` over one engine child. `options` (signal, timeoutMs) are not honoured: this port never cancels. */
function createEnginePort(child, { onReply } = {}) {
  let nextId = 0
  let closed = false
  const pending = new Map()
  const listeners = new Set()
  let stderrTail = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-4096)
  })
  const exited = new Promise((resolve) => child.on("close", resolve))
  const failAll = (message) => {
    for (const { reject } of pending.values()) reject({ message, code: "Closed", nothingSent: false })
    pending.clear()
  }
  child.on("error", (error) => failAll(`engine spawn failed: ${error.message}`))
  // A dead engine fails the port, never the process: no later heartbeat or call writes to its stdin (EPIPE).
  child.stdin.on("error", (error) => ((closed = true), failAll(`engine stdin failed: ${error.message}`)))
  void exited.then(() => ((closed = true), failAll(`engine exited; stderr tail: ${stderrTail.trim().slice(-400)}`)))
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.trim() === "") return
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      return
    }
    if (message.id !== undefined && message.id !== null && pending.has(message.id)) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      const wallMs = Number(process.hrtime.bigint() - entry.started) / 1e6
      if (message.error !== undefined) {
        onReply?.(entry.method, undefined, wallMs, message.error)
        entry.reject({ message: message.error.message, rpcCode: message.error.code, data: message.error.data ?? null })
      } else {
        onReply?.(entry.method, message.result, wallMs, undefined)
        entry.resolve(message.result)
      }
      return
    }
    if (typeof message.method === "string") for (const listener of listeners) listener(message)
  })
  const port = {
    call(method, params) {
      if (closed) return Promise.reject({ message: "engine port is closed", code: "Closed", nothingSent: true })
      const id = ++nextId
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject, started: process.hrtime.bigint() })
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })}\n`)
      })
    },
    notifications: {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    async close() {
      if (closed) return
      await Promise.race([port.call("session.close", {}).catch(() => undefined), delay(CLOSE_GRACE_MS)])
      closed = true
      child.stdin.end()
      const gone = await Promise.race([exited.then(() => true), delay(CLOSE_GRACE_MS).then(() => false)])
      // Only this harness's own child, by its own handle.
      if (!gone) child.kill("SIGKILL")
      await exited
    },
    get stderrTail() {
      return stderrTail
    },
  }
  return port
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.()
  })
}

/**
 * A `SpawnLaunch` for `connect({ kind: "spawn", launch })`. `env` is the whole child environment (the fake
 * backend rides `SENPI_DESKTOP_BACKEND`). `session` holds the `session.open` keys the eval wants; `reportMode`
 * and `trace` go out only when `engine.hello` lists `action-report` / `trace`, as the desktop service does.
 * `opened(info)` receives the hello reply and the port once the handshake finished.
 */
export function engineLauncher({ enginePath, env, session = {}, onReply, opened }) {
  return async (settings) => {
    const child = spawn(enginePath, ["--stdio"], { stdio: "pipe", env: withTelemetryOptOut(env), windowsHide: true })
    const port = createEnginePort(child, { onReply })
    let heartbeat
    try {
      const hello = await port.call("engine.hello", {})
      const features = Array.isArray(hello?.features) ? hello.features : []
      const wanted = { ...session, ...settings }
      const params = {
        allowHostRelayOnlyStop: true,
        showCursor: false,
        ...(wanted.auditPath === undefined ? {} : { auditPath: wanted.auditPath }),
        ...(features.includes("action-report") ? { reportMode: wanted.reportMode ?? "object" } : {}),
        ...(features.includes("trace") && wanted.trace === true ? { trace: true } : {}),
      }
      await port.call("session.open", params)
      await port.call("stopPath.start", { chord: STOP_CHORD })
      heartbeat = setInterval(() => {
        port.call("stopPath.heartbeat", {}).catch(() => undefined)
      }, HEARTBEAT_MS)
      heartbeat.unref?.()
      opened?.({ hello, features, params })
      const close = port.close
      return {
        call: port.call,
        notifications: port.notifications,
        async close() {
          clearInterval(heartbeat)
          await close()
        },
      }
    } catch (error) {
      clearInterval(heartbeat)
      await port.close()
      throw error instanceof Error ? error : new Error(`engine handshake failed: ${error?.message ?? String(error)}`)
    }
  }
}
