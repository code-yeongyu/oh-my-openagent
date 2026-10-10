import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RpcSpawnDescriptor } from "./spawn"
import { terminateRpcChild } from "./terminate"

// Bun 1.4 cold starts of the full Senpi CLI on Windows have exceeded the original 20s budget.
// Keep the established POSIX ceiling while giving Windows ~46% headroom over the observed 20.5s probe.
export const PROBE_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 20_000
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g

export type ModelCatalogProbeResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export type ModelCatalogSpawnOptions = {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  /** stdout is a file descriptor, never a pipe: see `probeModelCatalog`. */
  readonly stdio: ["ignore", number, "pipe"]
  readonly shell: false
  readonly windowsHide: true
  readonly detached: boolean
}

export type ModelCatalogProbeOptions = {
  readonly timeoutMs?: number
  readonly spawnProcess?: (
    command: string,
    args: readonly string[],
    options: ModelCatalogSpawnOptions,
  ) => ChildProcess
  readonly terminateChild?: (child: ChildProcess) => Promise<void>
}

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8")
  return next.length <= MAX_OUTPUT_BYTES ? next : next.slice(next.length - MAX_OUTPUT_BYTES)
}

function readCapturedStdout(path: string): string {
  const fd = openSync(path, "r")
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, MAX_OUTPUT_BYTES)
    const tail = Buffer.alloc(length)
    const read = readSync(fd, tail, 0, length, size - length)
    return tail.subarray(0, read).toString("utf8")
  } finally {
    closeSync(fd)
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseModelCatalog(output: string): ReadonlySet<string> {
  const models = new Set<string>()
  for (const rawLine of output.replace(ANSI_ESCAPE, "").split(/\r?\n/)) {
    const columns = rawLine.trim().split(/\s+/).filter((column) => column.length > 0)
    const provider = columns[0]
    const model = columns[1]
    if (provider === undefined || provider === "provider") continue
    if (model !== undefined && model !== "model") {
      models.add(`${provider}/${model}`)
      continue
    }
    if (provider.includes("/")) models.add(provider)
  }
  return models
}

/**
 * The catalog goes to a file, not a pipe. `senpi --list-models` writes its rows and calls
 * `process.exit(0)` at once; on a pipe the parent has not drained yet (a loaded host), every row past
 * the pipe buffer is dropped and the child still exits 0. The provider-sorted tail - `xai` - vanished
 * that way and admission rejected it as `model_not_in_child_profile` (#9068). A file write never
 * waits on the reader, so the listing is whole however slowly this process gets scheduled.
 */
export function probeModelCatalog(
  descriptor: RpcSpawnDescriptor,
  options: ModelCatalogProbeOptions = {},
): Promise<ModelCatalogProbeResult> {
  return new Promise((resolve) => {
    const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => (
      spawn(command, [...args], spawnOptions)
    ))
    const terminateChild = options.terminateChild ?? terminateRpcChild
    const captureDir = mkdtempSync(join(tmpdir(), "omo-model-catalog-"))
    const capturePath = join(captureDir, "stdout")
    // Removal can fail while a child that outlived a failed terminate still holds the file (Windows);
    // the probe result must not depend on it, so a failure is reported in stderr instead of thrown.
    const discardCapture = (): string | undefined => {
      try {
        rmSync(captureDir, { recursive: true, force: true })
        return undefined
      } catch (error) {
        return `could not remove the model catalog capture ${captureDir}: ${describeError(error)}`
      }
    }
    let child: ChildProcess
    try {
      const stdoutFd = openSync(capturePath, "w")
      try {
        child = spawnProcess(descriptor.command, descriptor.args, {
          cwd: descriptor.cwd,
          env: descriptor.env,
          stdio: ["ignore", stdoutFd, "pipe"],
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
        })
      } finally {
        closeSync(stdoutFd)
      }
    } catch (error) {
      discardCapture()
      throw error
    }
    if (child.stderr === null) {
      discardCapture()
      throw new Error("model catalog probe requires piped stderr")
    }
    let stderr = ""
    let settled = false
    let timingOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    // Never throws: a read or cleanup failure is appended to stderr, so admission always gets a result.
    const finish = (result: Omit<ModelCatalogProbeResult, "stdout">): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      const notes: string[] = []
      let stdout = ""
      try {
        stdout = readCapturedStdout(capturePath)
      } catch (error) {
        notes.push(`could not read the model catalog capture: ${describeError(error)}`)
      }
      const cleanupNote = discardCapture()
      if (cleanupNote !== undefined) notes.push(cleanupNote)
      resolve({ ...result, stdout, stderr: [result.stderr, ...notes].filter((part) => part.length > 0).join("\n") })
    }
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.once("error", (error) => {
      if (timingOut) return
      finish({ code: null, stderr: `${stderr}\n${error.message}`, timedOut: false })
    })
    child.once("close", (code) => {
      if (timingOut) return
      finish({ code, stderr, timedOut: false })
    })
    timeout = setTimeout(() => {
      if (settled || timingOut) return
      timingOut = true
      void terminateChild(child).then(
        () => finish({ code: null, stderr, timedOut: true }),
        (error: unknown) => finish({
          code: null,
          stderr: `${stderr}\nfailed to terminate model catalog probe: ${describeError(error)}`,
          timedOut: true,
        }),
      )
    }, options.timeoutMs ?? PROBE_TIMEOUT_MS)
    timeout.unref()
  })
}
