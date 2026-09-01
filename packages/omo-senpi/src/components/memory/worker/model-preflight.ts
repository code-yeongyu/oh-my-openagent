import { spawn } from "node:child_process"
import { stat } from "@oh-my-opencode/memory-core/fs"

import type { SenpiLauncher } from "@oh-my-opencode/senpi-task"

import type { MemoryModelChain } from "./memory-model-attempts"
import type { ReflectionModelCandidate } from "./resolve-model"

const PREFLIGHT_TIMEOUT_MS = 10_000
const CATALOG_CACHE_TTL_MS = 2 * 60_000
const DISCOVERY_DISABLED_MODEL_LIST_ARGS = [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--list-models",
] as const

export type ModelPreflightRejection = {
  readonly model: string
  readonly cause: "model_not_visible"
}

export type ModelPreflightResult =
  | {
      readonly kind: "filtered"
      readonly candidates: MemoryModelChain
      readonly rejected: readonly ModelPreflightRejection[]
    }
  | {
      readonly kind: "none_visible"
      readonly rejected: readonly ModelPreflightRejection[]
    }
  | {
      readonly kind: "unavailable"
      readonly candidates: MemoryModelChain
    }

type ModelPreflightInput = {
  readonly candidates: MemoryModelChain
  readonly launch: SenpiLauncher
  readonly env: NodeJS.ProcessEnv
  readonly configSources: readonly { readonly path: string; readonly exists: boolean }[]
  readonly warn?: (message: string, details?: unknown) => void
  readonly timeoutMs?: number
  readonly now?: () => number
}

type CatalogCacheEntry = {
  readonly visible: ReadonlySet<string>
  readonly probedAt: number
}

const catalogCache = new Map<string, CatalogCacheEntry>()

export async function preflightMemoryModels(input: ModelPreflightInput): Promise<ModelPreflightResult> {
  const cacheKey = await modelCatalogCacheKey(input.launch, input.configSources)
  const now = (input.now ?? Date.now)()
  const cached = catalogCache.get(cacheKey)
  const current = cached !== undefined && now - cached.probedAt < CATALOG_CACHE_TTL_MS ? cached : undefined
  let visible = current?.visible
  if (visible === undefined) {
    try {
      visible = await probeChildModels(input.launch, input.env, input.timeoutMs ?? PREFLIGHT_TIMEOUT_MS)
      catalogCache.set(cacheKey, { visible, probedAt: now })
    } catch (error) {
      input.warn?.("memory child model preflight failed; falling back to reactive model retries", {
        error: describe(error),
      })
      return { kind: "unavailable", candidates: input.candidates }
    }
  }

  const candidates = input.candidates.filter((candidate) => visible.has(candidate.model))
  const rejected = input.candidates
    .filter((candidate) => !visible.has(candidate.model))
    .map((candidate): ModelPreflightRejection => ({ model: candidate.model, cause: "model_not_visible" }))
  if (candidates.length === 0) {
    return current === undefined
      ? { kind: "none_visible", rejected }
      : { kind: "unavailable", candidates: input.candidates }
  }
  return { kind: "filtered", candidates: asMemoryModelChain(candidates), rejected }
}

export function resetModelPreflightCacheForTests(): void {
  catalogCache.clear()
}

async function probeChildModels(
  launch: SenpiLauncher,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ReadonlySet<string>> {
  const child = spawn(launch.command, [
    ...launch.prefixArgs,
    ...DISCOVERY_DISABLED_MODEL_LIST_ARGS,
  ], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  }).finally(() => clearTimeout(timeout))
  const stdoutText = Buffer.concat(stdout).toString("utf8")
  const stderrText = Buffer.concat(stderr).toString("utf8")
  if (timedOut) throw new Error(`model catalog probe timed out after ${timeoutMs}ms`)
  if (code !== 0) throw new Error(`model catalog probe exited with code ${code}: ${stderrText.trim() || stdoutText.trim()}`)
  const models = parseModelCatalog(stdoutText)
  if (models.size === 0) throw new Error("model catalog probe returned no parseable model ids")
  return models
}

function parseModelCatalog(output: string): ReadonlySet<string> {
  const models = new Set<string>()
  const lines = stripAnsi(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const headerIndex = lines.findIndex((line) => /^provider\s{2,}model(?:\s{2,}|$)/i.test(line))
  if (headerIndex >= 0) {
    for (const line of lines.slice(headerIndex + 1)) {
      const columns = line.split(/\s{2,}/)
      if (columns.length >= 2 && isProviderPart(columns[0] ?? "") && isModelIdPart(columns[1] ?? "")) {
        models.add(`${columns[0]}/${columns[1]}`)
      }
    }
    return models
  }
  for (const line of lines) {
    if (/^[^\s/]+\/[^\s]+$/.test(line)) models.add(line)
  }
  return models
}

async function modelCatalogCacheKey(
  launch: SenpiLauncher,
  sources: readonly { readonly path: string; readonly exists: boolean }[],
): Promise<string> {
  const sourceMtimes = await Promise.all(sources.filter((source) => source.exists).map(async (source) => {
    try {
      return `${source.path}:${(await stat(source.path)).mtimeMs}`
    } catch {
      return `${source.path}:missing`
    }
  }))
  return JSON.stringify([launch.command, launch.prefixArgs, sourceMtimes])
}

function asMemoryModelChain(candidates: readonly ReflectionModelCandidate[]): MemoryModelChain {
  const first = candidates[0]
  if (first === undefined) throw new Error("model preflight requires at least one visible candidate")
  return [first, ...candidates.slice(1)]
}

// A provider name never contains a slash, so the first column stays strict. A model id routinely does
// (`z-ai/glm-5.2-ultrafast-unlocked`, `deepseek-ai/deepseek-v4-pro`, most OpenRouter ids), and senpi
// resolves `<provider>/<model-id>` by splitting on the FIRST slash only, so the model column must keep
// everything after it verbatim.
function isProviderPart(value: string): boolean {
  return value.length > 0 && !/\s|\//.test(value)
}

function isModelIdPart(value: string): boolean {
  return value.length > 0 && !/\s/.test(value)
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
