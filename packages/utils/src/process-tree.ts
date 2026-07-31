import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

import {
  terminateProcessTree,
  type ProcessTreeTerminationReport,
} from "./process-tree-termination"

export type {
  ProcessTreeSignalAttempt,
  ProcessTreeSignalOutcome,
  ProcessTreeSignalTarget,
  ProcessTreeTerminationReport,
} from "./process-tree-termination"

export interface ProcessTreeRunOptions {
  readonly args: readonly string[]
  readonly command: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly maxBuffer: number
  readonly onTerminationReport?: (report: ProcessTreeTerminationReport) => void
  readonly terminationGraceMs?: number
  readonly terminationWaitMs?: number
  readonly timeoutSignal?: AbortSignal
  readonly timeoutMs: number
}

export interface ProcessTreeRunResult {
  readonly exitCode: number
  readonly signal: NodeJS.Signals | null
  readonly stderr: string
  readonly stdout: string
  readonly termination: ProcessTreeTerminationReport | null
  readonly timedOut: boolean
}

const DEFAULT_TERMINATION_GRACE_MS = 1_000
const DEFAULT_TERMINATION_WAIT_MS = 2_000

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
    let treeTermination: Promise<ProcessTreeTerminationReport> | undefined
    let resolveChildClosed: () => void = () => undefined
    const childClosed = new Promise<void>((resolveClosed) => {
      resolveChildClosed = resolveClosed
    })
    const stderrDecoder = new StringDecoder("utf8")
    const stdoutDecoder = new StringDecoder("utf8")

    const startTermination = (): Promise<ProcessTreeTerminationReport> => {
      if (treeTermination !== undefined) return treeTermination
      treeTermination = child.pid === undefined
        ? Promise.resolve({ attempts: [], survivorPids: [] })
        : terminateProcessTree(child.pid, {
            childClosed,
            graceMs: options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
            platform: process.platform,
            waitMs: options.terminationWaitMs ?? DEFAULT_TERMINATION_WAIT_MS,
          })
      treeTermination = treeTermination.then((report) => {
        try {
          options.onTerminationReport?.(report)
        } catch (error) {
          stderr += `[process-tree] termination observer failed: ${error instanceof Error ? error.message : String(error)}\n`
        }
        return report
      })
      return treeTermination
    }

    const capture = (target: "stderr" | "stdout", chunk: Buffer): void => {
      if (overflowed) return
      const currentBytes = target === "stdout" ? stdoutBytes : stderrBytes
      if (currentBytes + chunk.length > options.maxBuffer) {
        overflowed = true
        void startTermination().then(() => settle(1, null))
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

    let removeTimeoutSignal = (): void => undefined
    let timeout: ReturnType<typeof setTimeout>

    const settle = async (exitCode: number, signal: NodeJS.Signals | null): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      removeTimeoutSignal()
      const termination = treeTermination === undefined ? null : await treeTermination
      stderr += stderrDecoder.end()
      stdout += stdoutDecoder.end()
      resolvePromise({ exitCode, signal, stderr, stdout, termination, timedOut })
    }

    const triggerTimeout = (): void => {
      if (settled) return
      timedOut = true
      void startTermination().then(() => settle(124, child.signalCode))
    }
    timeout = setTimeout(triggerTimeout, options.timeoutMs)
    timeout.unref()
    if (options.timeoutSignal?.aborted === true) {
      triggerTimeout()
    } else if (options.timeoutSignal !== undefined) {
      const timeoutSignal = options.timeoutSignal
      timeoutSignal.addEventListener("abort", triggerTimeout, { once: true })
      removeTimeoutSignal = () => timeoutSignal.removeEventListener("abort", triggerTimeout)
    }

    child.once("error", () => {
      resolveChildClosed()
      void settle(1, null)
    })
    child.once("close", (code, signal) => {
      resolveChildClosed()
      void settle(timedOut ? 124 : overflowed ? 1 : (code ?? 1), signal)
    })
  })
}
