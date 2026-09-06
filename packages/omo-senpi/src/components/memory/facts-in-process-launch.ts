import { chmod, writeFile } from "@oh-my-opencode/memory-core/fs"
import { getProcessStartIdentity, loadFactsPersona, serializeFactsPayload, type FactsPayload } from "@oh-my-opencode/memory-core"
import { join } from "node:path"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { runInProcessMemoryChild, type InProcessMemoryChildState, type MemoryChildResult, type StartChildInput } from "./in-process-memory-child"
import { createFactsRecordTool, FACTS_RECORD_TOOL_NAME } from "./facts-record-tool"
import type { FactsQueuedKey } from "./facts-failure-recording"
import { type ReflectionModelCandidate, type ReflectionModelResolution } from "./worker/resolve-model"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"
import { updateRunLedger, writeRunJsonAtomic, type RunOutcome, type RunAttempt } from "./worker/run-artifacts"
import type { FactsExtractorRunnerOptions } from "./facts-runner-types"

type ResolvedChildModel = NonNullable<StartChildInput["model"]>

type FactsInProcessLaunchInput = {
  readonly runId: string
  readonly runDir: string
  readonly payload: FactsPayload
  readonly resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>
  readonly modelRegistry?: ReturnType<FactsExtractorRunnerOptions["resolveModelRegistry"]>
  readonly options: FactsExtractorRunnerOptions
  readonly env: NodeJS.ProcessEnv
  readonly configSources: readonly { readonly path: string; readonly exists: boolean }[]
  readonly batchId: string
  readonly queued: readonly FactsQueuedKey[]
  readonly launchedAt: number
  readonly deadlineMs: number
  readonly onState?: (state: InProcessMemoryChildState) => void
}

export async function launchFactsInProcess(input: FactsInProcessLaunchInput): Promise<boolean> {
  const candidates: readonly [ReflectionModelCandidate, ...ReflectionModelCandidate[]] = [
    { model: input.resolution.model, ...(input.resolution.thinking === undefined ? {} : { thinking: input.resolution.thinking }) },
    ...input.resolution.fallbacks,
  ]
  const registry = input.modelRegistry
  const taskRuntime = await import("#omo-task-runtime")
  const tried: string[] = []
  for (const [index, candidate] of candidates.entries()) {
    const attempt = index + 1
    tried.push(candidate.model)
    const model = registry === undefined || !isModelFinder(registry)
      ? undefined
      : taskRuntime.findModelReference<ResolvedChildModel>(registry, candidate.model)
    if (registry === undefined || model === undefined || model === null) {
      input.options.logger?.warn("facts model candidate skipped because it is not visible in the live registry", {
        model: candidate.model,
        attempt,
      })
      continue
    }
    const result = await launchCandidate(input, candidate, model, attempt, candidates[index + 1] === undefined ? undefined : {
      attempt: attempt + 1,
      model: candidates[index + 1].model,
      ...(candidates[index + 1].thinking === undefined ? {} : { thinking: candidates[index + 1].thinking }),
    })
    if (result.status === "completed") return false
    if (result.cause === "cancelled") return true
    if (result.cause !== "session_create_failed") return false
  }
  throw new Error(`No facts model candidate launched; tried: ${tried.length === 0 ? candidates.map((candidate) => candidate.model).join(", ") : tried.join(", ")}`)
}

async function launchCandidate(
  input: FactsInProcessLaunchInput,
  candidate: ReflectionModelCandidate,
  model: ResolvedChildModel,
  attempt: number,
  _nextAttempt: RunAttempt | undefined,
): Promise<MemoryChildResult> {
  const payloadText = serializeFactsPayload(input.payload)
  const payloadPath = join(input.runDir, "facts-payload.json")
  const extractionPath = join(input.runDir, "extraction.jsonl")
  const state: InProcessMemoryChildState = { cancelled: false }
  const tool = createFactsRecordTool({ extractionPath, state })
  input.onState?.(state)
  const result = await runInProcessMemoryChild({
    runId: input.runId,
    deadlineMs: input.deadlineMs,
    state,
    logger: input.options.logger,
    ...(input.options.createRunner === undefined ? {} : { createRunner: input.options.createRunner }),
    ...(input.options.createSession === undefined ? {} : { createSession: input.options.createSession }),
    setup: async () => {
      await chmod(payloadPath, 0o600).catch((error: unknown) => {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      })
      await writeFile(payloadPath, payloadText, { encoding: "utf8", mode: 0o600 })
      await chmod(payloadPath, 0o400)
      await writeFile(extractionPath, "", { encoding: "utf8", mode: 0o600 })
      await updateRunLedger(join(input.runDir, "ledger.json"), {
        attempt,
        model: candidate.model,
        ...(candidate.thinking === undefined ? {} : { thinking: candidate.thinking }),
        pid: process.pid,
        processStart: await getProcessStartIdentity(process.pid),
        // childPid is intentionally absent: this run is owned by the parent process. Reconciliation
        // therefore treats a missing child identity as unknown liveness and abandons, not fails.
      })
    },
    buildStart: () => buildStart(input, candidate, model, payloadText, tool),
    onHandle: () => undefined,
    ...(input.onState === undefined ? {} : { onState: input.onState }),
  })
  if (result.status === "failed" && result.cause === "cancelled") {
    tool.deactivate()
    return result
  }
  const timedOut = result.status === "failed" && result.cause === "deadline"
  const outcome: RunOutcome = timedOut
    ? { version: 1, runId: input.runId, attempt, finishedAt: new Date().toISOString(), childExit: { code: null, signal: null }, timedOut: true }
    : { version: 1, runId: input.runId, attempt, finishedAt: new Date().toISOString(), childExit: { code: result.status === "completed" ? 0 : 1, signal: null }, timedOut: false }
  await writeRunJsonAtomic(join(input.runDir, "outcome.json"), outcome)
  tool.deactivate()
  return result
}

function buildStart(
  input: FactsInProcessLaunchInput,
  candidate: ReflectionModelCandidate,
  model: ResolvedChildModel,
  payloadText: string,
  tool: ReturnType<typeof createFactsRecordTool>,
): StartChildInput {
  const childRegistry = isChildModelRegistry(input.modelRegistry) ? input.modelRegistry : undefined
  return {
    taskId: `facts-${input.runId}`,
    cwd: input.runDir,
    sessionDir: input.runDir,
    agentDir: resolveAgentHome({ env: input.env }),
    modelRegistry: childRegistry,
    model,
    ...(candidate.thinking === undefined ? {} : { thinkingLevel: candidate.thinking }),
    toolAllowlist: [FACTS_RECORD_TOOL_NAME],
    memberScopedTools: [tool],
    depth: 1,
    parentSessionId: `facts-${input.runId}`,
    rootSessionId: `facts-${input.runId}`,
    systemPrompt: loadFactsPersona(),
    promptEnvelope: "bare",
    prompt: `Extract durable facts from this payload and record each accepted fact with ${FACTS_RECORD_TOOL_NAME}.\n\n${payloadText}`,
  }
}

function isModelFinder(value: unknown): value is { readonly find: (provider: string, modelId: string) => ResolvedChildModel | undefined } {
  return value !== null && typeof value === "object" && "find" in value && typeof value.find === "function"
}

function isChildModelRegistry(value: unknown): value is ChildModelRegistry {
  return value !== null && typeof value === "object" && "getProviderAuth" in value
    && typeof value.getProviderAuth === "function"
}
