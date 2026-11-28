import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"

export const RECONCILE_WATCHDOG_MS = 360_000
export const RELAUNCH_TIMEOUT_MS = 120_000
export const OUTPUT_TAIL_LIMIT = 16_384

export function captureChild(child, onOutput = () => {}) {
  let stdout = ""
  let stderr = ""
  const stopped = new AbortController()
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-OUTPUT_TAIL_LIMIT)
    onOutput()
  })
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-OUTPUT_TAIL_LIMIT)
    onOutput()
  })
  const snapshot = () => ({
    pid: child.pid,
    status: child.exitCode,
    signal: child.signalCode,
    stdoutTail: stdout,
    stderrTail: stderr,
  })
  const closed = new Promise((resolve) => {
    child.once("close", () => {
      stopped.abort()
      resolve(snapshot())
    })
    child.once("error", (error) => {
      stderr = (stderr + String(error)).slice(-OUTPUT_TAIL_LIMIT)
      stopped.abort()
      resolve(snapshot())
    })
  })
  return { closed, snapshot, signal: stopped.signal }
}

export function stageRecorder(
  onStage = (entry) => {
    if (process.env.OMO_RECONCILE_STAGES === "1") {
      process.stderr.write(`OMO_RECONCILE_STAGE ${JSON.stringify(entry)}\n`)
    }
  },
) {
  const started = performance.now()
  const stages = []
  return {
    stages,
    mark(stage, facts = {}) {
      const elapsedMs = performance.now() - started
      const entry = { stage, elapsedMs, durationMs: elapsedMs - (stages.at(-1)?.elapsedMs ?? 0), ...facts }
      stages.push(entry)
      onStage(entry)
    },
  }
}

export async function withinDeadline(promise, ms, beforeTimeout) {
  let timer
  try {
    return await new Promise((resolve, reject) => {
      let expired = false
      timer = setTimeout(() => {
        expired = true
        Promise.resolve()
          .then(beforeTimeout)
          .then(() => reject(new Error(`deadline exceeded after ${ms}ms`)), reject)
      }, ms)
      promise.then(
        (value) => {
          if (!expired) resolve(value)
        },
        (error) => {
          if (!expired) reject(error)
        },
      )
    })
  } finally {
    clearTimeout(timer)
  }
}

export function captureCommand(file, args, maxBuffer = 1024 * 1024) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", timeout: 5_000, maxBuffer }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error?.message ?? null })
    })
  })
}

const PS_DUMP_COMMAND_LIMIT = 200

export async function runProcesses(rootPids, namespace) {
  const ps = spawn("ps", ["-ww", "-axo", "pid=,ppid=,stat=,command="], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  })
  const closed = once(ps, "close")
  let stderr = ""
  ps.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-OUTPUT_TAIL_LIMIT)
  })
  const rows = []
  const lines = createInterface({ input: ps.stdout, crlfDelay: Infinity })
  lines.on("line", (line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), state: match[3], command: match[4] })
  })
  const [status, signal] = await closed.catch((error) => {
    throw new Error(`process enumeration failed: ${error.message}`, { cause: error })
  })
  if (status !== 0) {
    const reason = signal ? `ps terminated by ${signal}` : `ps exited with code ${status}`
    const detail = stderr.trim()
    throw new Error(`process enumeration failed: ${reason}${detail ? `: ${detail}` : ""}`)
  }
  const owned = new Set(rootPids.filter(Number.isSafeInteger))
  const ancestors = new Set([process.pid])
  let ancestor = process.ppid
  while (ancestor > 0 && !ancestors.has(ancestor)) {
    ancestors.add(ancestor)
    ancestor = rows.find((row) => row.pid === ancestor)?.ppid ?? 0
  }
  for (const row of rows) {
    if (namespace && !ancestors.has(row.pid) && row.command.includes(namespace)) owned.add(row.pid)
  }
  let added
  do {
    added = false
    for (const row of rows) {
      if (!ancestors.has(row.pid) && !owned.has(row.pid) && owned.has(row.ppid)) {
        owned.add(row.pid)
        added = true
      }
    }
  } while (added)
  return rows.filter((row) => owned.has(row.pid) && row.pid !== process.pid)
}

export async function dumpRunProcesses(rootPids, namespace) {
  if (process.platform === "win32") {
    return { tasklist: await captureCommand("tasklist.exe", ["/FO", "CSV"]), roots: rootPids }
  }
  const processes = (await runProcesses(rootPids, namespace)).map((row) => ({
    ...row,
    command: row.command.slice(0, PS_DUMP_COMMAND_LIMIT),
  }))
  const sockets = await Promise.all(
    processes.map(async ({ pid }) => ({
      pid,
      ...(await captureCommand("lsof", ["-nP", "-p", String(pid)])),
    })),
  )
  return { processes, sockets }
}

export async function sampleFseventsd() {
  if (process.platform !== "darwin") return { supported: false, values: [] }
  const result = await captureCommand("/bin/sh", ["-c", "ps -A -o %cpu=,comm= | awk '/fseventsd/{print $1}'"])
  return {
    supported: true,
    values: result.stdout.trim().split(/\s+/).filter(Boolean).map(Number),
    error: result.error,
  }
}
