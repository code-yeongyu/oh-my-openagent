import { spawn } from "node:child_process"

// The bootstrap itself runs in its own omo process (`omo remote bootstrap --json`), so its account read, download,
// install and connection never share the engine's event loop. Its last stdout line is the report.
const BOOTSTRAP_ARGS = ["remote", "bootstrap", "--json"] as const
const REPORT_MAX_BYTES = 64 * 1024
// The worker's own steps are each bounded: two download rounds of up to 120 s, then up to 120 s of install-service, plus
// a 5 s account read and the local handshakes. Ten minutes outlasts all of them with room; past it the child is stopped.
const BOOTSTRAP_DEADLINE_MS = 10 * 60_000

/** Schedules `expire` and returns its cancel; the default is an unref'd timer at the deadline. */
export type DeadlineScheduler = (expire: () => void) => () => void

const atDeadline: DeadlineScheduler = (expire) => {
  const timer = setTimeout(expire, BOOTSTRAP_DEADLINE_MS)
  timer.unref()
  return () => clearTimeout(timer)
}

/** The worker did not finish within its deadline and was stopped. */
export class BootstrapWorkerTimeout extends Error {
  constructor() {
    super(`omo remote bootstrap did not finish within ${BOOTSTRAP_DEADLINE_MS / 60_000} minutes and was stopped`)
    this.name = "BootstrapWorkerTimeout"
  }
}

export type BootstrapReport = { readonly state: "connected" } | { readonly state: string; readonly notice: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The worker's last stdout line as a report; undefined when it is not one. */
function parseBootstrapReport(stdout: string): BootstrapReport | undefined {
  const line = stdout.trim().split("\n").at(-1) ?? ""
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  if (!isRecord(value)) return undefined
  const { state, notice } = value
  if (state === "connected") return { state }
  if (typeof state !== "string" || state === "" || typeof notice !== "string" || notice === "") return undefined
  return { state, notice }
}

/**
 * Starts `<omo> remote bootstrap --json` and resolves with its report. An npm launcher (`bin/omo.js`) runs under
 * this runtime; a compiled omo runs directly. The child never keeps the engine alive: a session that ends first
 * simply leaves it to finish. Rejects when the binary cannot be started, and with BootstrapWorkerTimeout once the child
 * was stopped at its deadline.
 */
export function runBootstrapWorker(
  omoBin: string,
  options: { readonly execPath?: string; readonly schedule?: DeadlineScheduler } = {},
): Promise<BootstrapReport | undefined> {
  const execPath = options.execPath ?? process.execPath
  const [command, ...args] = omoBin.endsWith(".js")
    ? [execPath, omoBin, ...BOOTSTRAP_ARGS]
    : [omoBin, ...BOOTSTRAP_ARGS]
  return new Promise((resolve, reject) => {
    const child = spawn(command ?? omoBin, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
    let timedOut = false
    const cancel = (options.schedule ?? atDeadline)(() => {
      timedOut = true
      child.kill()
    })
    const chunks: Buffer[] = []
    let bytes = 0
    child.stdout.on("data", (chunk: Buffer) => {
      if (bytes >= REPORT_MAX_BYTES) return
      bytes += chunk.length
      chunks.push(chunk)
    })
    child.once("error", (error) => {
      cancel()
      reject(error)
    })
    child.once("close", () => {
      cancel()
      if (timedOut) reject(new BootstrapWorkerTimeout())
      else resolve(parseBootstrapReport(Buffer.concat(chunks).toString("utf8")))
    })
    child.unref()
    const pipe: unknown = child.stdout
    if (isRecord(pipe) && typeof pipe.unref === "function") pipe.unref()
  })
}
