import { spawn, type ChildProcess } from "node:child_process"

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
  readonly stdio: ["ignore", "pipe", "pipe"]
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

export function probeModelCatalog(
  descriptor: RpcSpawnDescriptor,
  options: ModelCatalogProbeOptions = {},
): Promise<ModelCatalogProbeResult> {
  return new Promise((resolve) => {
    const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => (
      spawn(command, [...args], spawnOptions)
    ))
    const terminateChild = options.terminateChild ?? terminateRpcChild
    const child = spawnProcess(descriptor.command, descriptor.args, {
      cwd: descriptor.cwd,
      env: descriptor.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    })
    if (child.stdout === null || child.stderr === null) {
      throw new Error("model catalog probe requires piped stdout and stderr")
    }
    let stdout = ""
    let stderr = ""
    let settled = false
    let timingOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (result: ModelCatalogProbeResult): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      resolve(result)
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.once("error", (error) => {
      if (timingOut) return
      finish({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut: false })
    })
    child.once("close", (code) => {
      if (timingOut) return
      finish({ code, stdout, stderr, timedOut: false })
    })
    timeout = setTimeout(() => {
      if (settled || timingOut) return
      timingOut = true
      void terminateChild(child).then(
        () => finish({ code: null, stdout, stderr, timedOut: true }),
        (error: unknown) => finish({
          code: null,
          stdout,
          stderr: `${stderr}\nfailed to terminate model catalog probe: ${
            error instanceof Error ? error.message : String(error)
          }`,
          timedOut: true,
        }),
      )
    }, options.timeoutMs ?? PROBE_TIMEOUT_MS)
    timeout.unref()
  })
}
