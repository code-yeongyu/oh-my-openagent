// Which model answers for the resident Kibitzer, and what its child session looks like.
//
// The sidecar is pinned to one category (`memory.recall.category`, default `quick`): an advisor
// that reads a live transcript must never land on an arbitrary, possibly frontier-priced model, so
// the beyond-category ladder the reflection worker tolerates is refused here - the category's own
// chain is the only fallback ladder, carried into the child where the engine rotates rungs. The
// ChildSpec is the normative tool registry: exactly the five read-only closures, bare envelopes
// (the seed IS the first user message), and turn completion (a silent turn is a finished turn).

import { loadKibitzerPersona, PERSONA_ASSET_FILENAMES } from "@oh-my-opencode/memory-core"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type {
  ChildHandle,
  ChildModelRegistry,
  ChildSpec,
  CreateChildSession,
  InProcessRunnerLike,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

import { childModelChainSpec, type ChildModelChainSpec } from "../memory-child-model-chain"
import { resolveReflectionModel, type ReflectionModelCandidate, type ReflectionThinkingLevel } from "../worker/resolve-model"
import type { KibitzerSidecarChildInput } from "./sidecar"
import { KIBITZER_SIDECAR_TOOL_NAMES } from "./sidecar-prompt"
import { loadKibitzerTaskRuntime, type KibitzerTaskRuntime } from "./task-runtime"
import type { AnyKibitzerSidecarTool } from "./tools/result"

export const KIBITZER_SIDECAR_DEFAULT_CATEGORY = "quick"

export type KibitzerSidecarModelUnavailableCause = "registry_snapshot_unavailable" | "category_unavailable" | "beyond_category"

export type KibitzerSidecarModelResolution =
  | {
    readonly kind: "resolved"
    readonly category: string
    readonly model: string
    readonly thinking?: ReflectionThinkingLevel
    readonly fallbacks: readonly ReflectionModelCandidate[]
    readonly chain: ChildModelChainSpec
  }
  | { readonly kind: "unavailable"; readonly category: string; readonly cause: KibitzerSidecarModelUnavailableCause }

export interface KibitzerSidecarModelInput {
  /** `memory.recall.category`; defaults to {@link KIBITZER_SIDECAR_DEFAULT_CATEGORY}. */
  readonly category?: string
  readonly config: OmoConfig
  /** The parent's registry, captured synchronously at a hook; absent means no honest answer exists. */
  readonly registry: SenpiModelRegistryPort<SenpiModelPort> | undefined
}

export function resolveKibitzerSidecarModel(input: KibitzerSidecarModelInput): KibitzerSidecarModelResolution {
  const category = input.category ?? KIBITZER_SIDECAR_DEFAULT_CATEGORY
  if (input.registry === undefined) return { kind: "unavailable", category, cause: "registry_snapshot_unavailable" }
  const resolution = resolveReflectionModel(category, input.config, input.registry)
  if (resolution.kind === "category_unavailable") return { kind: "unavailable", category, cause: "category_unavailable" }
  // Category-sourced resolutions carry no `source`; registry_fallback / session_inherit do.
  if (resolution.source !== undefined) return { kind: "unavailable", category, cause: "beyond_category" }
  return {
    kind: "resolved",
    category: resolution.category,
    model: resolution.model,
    ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
    fallbacks: resolution.fallbacks,
    chain: childModelChainSpec({ model: resolution.model, fallbacks: resolution.fallbacks }),
  }
}

export interface KibitzerSidecarSpecInput {
  readonly sessionId: string
  /** Child number within the session; part of the task id so a recreated child never reuses one. */
  readonly generation: number
  /** The primary agent's workspace: `read` and `grep` are scoped to it. */
  readonly cwd: string
  /** `recall/sidecars/<encoded-session>/`: the child's JSONL transcript is the audit trail. */
  readonly sessionDir: string
  readonly agentDir: string
  readonly modelRegistry: ChildModelRegistry | undefined
  readonly model: ChildSpec["model"]
  readonly chain: ChildModelChainSpec
  readonly thinkingLevel?: ChildSpec["thinkingLevel"]
  /** The persona text, read by the caller so a missing asset is reported as itself. */
  readonly systemPrompt: string
  /** The five member-scoped closures, in registry order. */
  readonly tools: readonly AnyKibitzerSidecarTool[]
  /** The seed (or reseed + wake) envelope: the child's first user message, verbatim. */
  readonly prompt: string
}

export function buildKibitzerSidecarSpec(input: KibitzerSidecarSpecInput): ChildSpec {
  return {
    taskId: `kibitzer-${input.sessionId}-${input.generation}`,
    cwd: input.cwd,
    sessionDir: input.sessionDir,
    agentDir: input.agentDir,
    ...(input.modelRegistry === undefined ? {} : { modelRegistry: input.modelRegistry }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...input.chain,
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    toolAllowlist: [...KIBITZER_SIDECAR_TOOL_NAMES],
    memberScopedToolNames: input.tools.map((tool) => tool.name),
    memberScopedTools: input.tools as ChildSpec["memberScopedTools"],
    depth: 1,
    parentSessionId: input.sessionId,
    rootSessionId: input.sessionId,
    systemPrompt: input.systemPrompt,
    promptEnvelope: "bare",
    completion: "turn",
    prompt: input.prompt,
  }
}

export type KibitzerSidecarStartCode =
  | KibitzerSidecarModelUnavailableCause
  | "persona_unavailable"
  | "runtime_unavailable"
  | "session_create_failed"

/** A child that could not be started, named by the stage that refused; the sidecar backs off on it. */
export class KibitzerSidecarStartError extends Error {
  readonly code: KibitzerSidecarStartCode

  constructor(code: KibitzerSidecarStartCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = "KibitzerSidecarStartError"
    this.code = code
  }
}

export interface KibitzerSidecarChildStarterOptions {
  readonly cwd: string
  readonly sessionDir: string
  readonly agentDir: string
  readonly category?: string
  readonly loadConfig: () => OmoConfig
  /** The newest registry snapshot the hooks captured; read at start time, never cached here. */
  readonly modelRegistry: () => ChildModelRegistry | undefined
  /** QA seam; production reads the primed persona asset. */
  readonly loadPersona?: () => string
  /** QA seam; production awaits the primed `#omo-task-runtime` load. */
  readonly loadTaskRuntime?: () => Promise<Pick<KibitzerTaskRuntime, "createInProcessJudgeRunner" | "findModelReference">>
  /** QA seam mirroring the facts runner: replaces the child session construction. */
  readonly createSession?: CreateChildSession
  /** QA seam: replaces the in-process runner entirely. */
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
}

/**
 * The production `startChild` port of the sidecar: resolves the pinned category against the live
 * registry snapshot, reads the persona, builds the spec and starts ONE in-process child whose first
 * turn is the given prompt. Every refusal is a typed {@link KibitzerSidecarStartError}.
 */
export function createKibitzerSidecarChildStarter(
  options: KibitzerSidecarChildStarterOptions,
): (input: KibitzerSidecarChildInput) => Promise<ChildHandle> {
  return async (input) => {
    const registry = options.modelRegistry()
    const resolution = resolveKibitzerSidecarModel({
      ...(options.category === undefined ? {} : { category: options.category }),
      config: options.loadConfig(),
      registry,
    })
    if (resolution.kind === "unavailable") {
      throw new KibitzerSidecarStartError(resolution.cause, `Kibitzer sidecar model unavailable: ${resolution.category} (${resolution.cause})`)
    }
    let systemPrompt: string
    try {
      systemPrompt = (options.loadPersona ?? loadKibitzerPersona)()
    } catch (error) {
      throw new KibitzerSidecarStartError("persona_unavailable", `${PERSONA_ASSET_FILENAMES.kibitzer}: ${describe(error)}`, { cause: error })
    }
    let runtime: Pick<KibitzerTaskRuntime, "createInProcessJudgeRunner" | "findModelReference"> | undefined
    if (options.createRunner === undefined) {
      try {
        runtime = await (options.loadTaskRuntime ?? loadKibitzerTaskRuntime)()
      } catch (error) {
        throw new KibitzerSidecarStartError("runtime_unavailable", describe(error), { cause: error })
      }
    }
    const runnerOptions = options.createSession === undefined ? {} : { createSession: options.createSession }
    const runner = options.createRunner?.(runnerOptions) ?? runtime?.createInProcessJudgeRunner(runnerOptions)
    if (runner === undefined) throw new KibitzerSidecarStartError("runtime_unavailable", "no in-process runner available")
    const spec = buildKibitzerSidecarSpec({
      sessionId: input.sessionId,
      generation: input.generation,
      cwd: options.cwd,
      sessionDir: options.sessionDir,
      agentDir: options.agentDir,
      modelRegistry: registry,
      model: registry === undefined || runtime === undefined ? undefined : runtime.findModelReference(registry, resolution.model),
      chain: resolution.chain,
      ...(resolution.thinking === undefined ? {} : { thinkingLevel: resolution.thinking }),
      systemPrompt,
      tools: input.tools,
      prompt: input.prompt,
    })
    try {
      return await runner.start(spec)
    } catch (error) {
      throw new KibitzerSidecarStartError("session_create_failed", describe(error), { cause: error })
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
