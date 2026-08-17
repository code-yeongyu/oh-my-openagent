import { spawn, type ChildProcess } from "node:child_process"

import { RunnerError } from "../in-process/runner-error"
import type { RpcRunnerSpec } from "../types"
import { buildRpcModelCatalogSpawn, type RpcSpawnDescriptor } from "./spawn"
import { terminateRpcChild } from "./terminate"

const PROBE_TIMEOUT_MS = 20_000
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

/**
 * A successful catalog is cached only briefly: `senpi auth login` or an edit to the child-visible
 * settings changes which models resolve, and nothing in this process observes that. A short TTL
 * bounds how long a stale success can reject an otherwise valid model.
 */
export const MODEL_CATALOG_CACHE_TTL_MS = 120_000
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g

type ModelCatalogProbeResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

type ModelCatalogSpawnOptions = {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly stdio: ["ignore", "pipe", "pipe"]
  readonly shell: false
  readonly windowsHide: true
  readonly detached: boolean
}

type ModelCatalogProbeOptions = {
  readonly timeoutMs?: number
  readonly spawnProcess?: (
    command: string,
    args: readonly string[],
    options: ModelCatalogSpawnOptions,
  ) => ChildProcess
  readonly terminateChild?: (child: ChildProcess) => Promise<void>
}

export type RpcModelAdmission = (spec: RpcRunnerSpec) => Promise<void>

export type RpcModelAdmissionOptions = {
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly probe?: (descriptor: RpcSpawnDescriptor) => Promise<ModelCatalogProbeResult>
  readonly now?: () => number
}

type ProbedCatalog = {
  readonly models: ReadonlySet<string>
  readonly stderrTail: string
}

type CachedCatalog = {
  readonly catalog: Promise<ProbedCatalog>
  readonly cachedAt: number
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

function profileKey(descriptor: RpcSpawnDescriptor): string {
  return JSON.stringify([
    descriptor.command,
    descriptor.args,
    descriptor.cwd,
    descriptor.env.OMO_CODING_AGENT_DIR,
    descriptor.env.SENPI_CODING_AGENT_DIR,
    descriptor.env.PI_CODING_AGENT_DIR,
    descriptor.env.HOME,
    descriptor.env.USERPROFILE,
    descriptor.env.XDG_CONFIG_HOME,
  ])
}

function admissionFailure(model: string, message: string, cause?: unknown): RunnerError {
  return new RunnerError({
    kind: "model_unavailable",
    message: `process model admission failed for ${model}: ${message}`,
    ...(cause === undefined ? {} : { cause }),
  })
}

export function createRpcModelAdmission(options: RpcModelAdmissionOptions = {}): RpcModelAdmission {
  const buildSpawn = options.buildSpawn ?? buildRpcModelCatalogSpawn
  const probe = options.probe ?? probeModelCatalog
  const now = options.now ?? Date.now
  const catalogs = new Map<string, CachedCatalog>()

  return async (spec) => {
    const model = spec.model?.trim()
    if (model === undefined || model.length === 0) return
    const descriptor = buildSpawn(spec)
    const key = profileKey(descriptor)
    const cached = catalogs.get(key)
    let catalog = cached !== undefined && now() - cached.cachedAt < MODEL_CATALOG_CACHE_TTL_MS ? cached.catalog : undefined
    if (catalog === undefined) {
      catalog = probe(descriptor).then((result) => {
        if (result.timedOut) throw admissionFailure(model, "catalog probe timed out")
        if (result.code !== 0) {
          const detail = result.stderr.trim().slice(-2_000)
          throw admissionFailure(model, `catalog probe exited ${result.code}${detail.length === 0 ? "" : `: ${detail}`}`)
        }
        return { models: parseModelCatalog(result.stdout), stderrTail: result.stderr.trim().slice(-1_000) }
      })
      catalogs.set(key, { catalog, cachedAt: now() })
    }
    try {
      const available = await catalog
      if (!available.models.has(model)) {
        throw admissionFailure(
          model,
          `model is not visible in the child profile (probed catalog has ${available.models.size} models${
            available.stderrTail.length === 0 ? "" : `; child stderr: ${available.stderrTail}`
          }); forward its provider extension or child-visible settings`,
        )
      }
    } catch (error) {
      catalogs.delete(key)
      throw error
    }
  }
}
