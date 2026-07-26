import { execFile, spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

export interface ProcessTreeRunOptions {
  readonly args: readonly string[]
  readonly command: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly maxBuffer: number
  readonly timeoutMs: number
}

export interface ProcessTreeRunResult {
  readonly exitCode: number
  readonly signal: NodeJS.Signals | null
  readonly stderr: string
  readonly stdout: string
  readonly timedOut: boolean
}

export function runProcessWithTreeTimeout(options: ProcessTreeRunOptions): Promise<ProcessTreeRunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stderr = ""
    let stderrBytes = 0
    let stdout = ""
    let stdoutBytes = 0
    let timedOut = false
    let overflowed = false
    let settled = false
    let treeTermination: Promise<void> | undefined
    const stderrDecoder = new StringDecoder("utf8")
    const stdoutDecoder = new StringDecoder("utf8")

    const capture = (target: "stderr" | "stdout", chunk: Buffer): void => {
      if (overflowed) return
      const currentBytes = target === "stdout" ? stdoutBytes : stderrBytes
      if (currentBytes + chunk.length > options.maxBuffer) {
        overflowed = true
        treeTermination ??= terminateProcessTree(child.pid)
        return
      }
      if (target === "stdout") {
        stdoutBytes += chunk.length
        stdout += stdoutDecoder.write(chunk)
      } else {
        stderrBytes += chunk.length
        stderr += stderrDecoder.write(chunk)
      }
    }

    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk))

    const timeout = setTimeout(() => {
      timedOut = true
      treeTermination ??= terminateProcessTree(child.pid)
    }, options.timeoutMs)
    timeout.unref()

    const settle = async (exitCode: number, signal: NodeJS.Signals | null): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      await treeTermination
      stderr += stderrDecoder.end()
      stdout += stdoutDecoder.end()
      resolvePromise({ exitCode, signal, stderr, stdout, timedOut })
    }

    child.once("error", () => void settle(1, null))
    child.once("close", (code, signal) => void settle(overflowed ? 1 : (code ?? 1), signal))
  })
}

function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) return Promise.resolve()
  if (process.platform === "win32") return taskkillProcessTree(pid)
  try {
    process.kill(-pid, "SIGKILL")
  } catch (error) {
    if (!isIgnorableKillError(error)) throw error
  }
  return Promise.resolve()
}

function taskkillProcessTree(pid: number): Promise<void> {
  return new Promise((resolvePromise) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      { timeout: 5_000, windowsHide: true },
      () => resolvePromise(),
    )
  })
}

function isIgnorableKillError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error.code === "EPERM" || error.code === "ESRCH")
}
