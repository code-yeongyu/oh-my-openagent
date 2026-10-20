import type { AgentToolResult } from "@code-yeongyu/senpi"
import type { Static } from "typebox"

import type { MemoryFactsApplier, MemoryFactsApplyResponse } from "../memory/facts-apply-rpc"
import { resolveMemoryModelRegistry } from "../memory/model-registry-resolver"
import type { OnboardingMemoryApplyParams, OnboardingUnderstandDetails, OnboardingUnderstandParams, TuiOnboardingScan } from "./tui-memory-tools"
import type { OnboardingFactCandidate, OnboardingUnderstandEvent } from "./understand-contract"
import { startOnboardingUnderstanding, type OnboardingUnderstandingSeams } from "./understand-start"

interface ToolCtx {
  readonly model?: { readonly provider?: unknown; readonly id?: unknown }
  readonly sessionManager?: { getSessionId(): string }
}

type Runs = Map<string, readonly OnboardingFactCandidate[]>

export async function executeOnboardingUnderstand(input: {
  readonly params: Static<typeof OnboardingUnderstandParams>
  readonly signal: AbortSignal | undefined
  readonly ectx: unknown
  readonly runs: Runs
  readonly scan: () => Promise<TuiOnboardingScan | undefined>
  readonly seams?: OnboardingUnderstandingSeams
}): Promise<AgentToolResult<OnboardingUnderstandDetails>> {
  const { params, signal, ectx, runs } = input
  const ctx = ectx as unknown as ToolCtx
  const model = params.model ?? currentModel(ctx)
  if (model === undefined) return failure("No model is selected in this session; pass model as provider/model.")
  const modelRegistry = resolveMemoryModelRegistry(ectx)
  if (modelRegistry === undefined) return failure("This session exposes no model registry, so the understanding cannot run.")
  const scan = await input.scan().catch(() => undefined)
  if (scan === undefined) return failure("The onboarding scan did not run; continue with the scan rows only.")
  const steps: string[] = []
  const started = await startOnboardingUnderstanding({
    scanId: scan.scanId,
    model,
    digests: scan.digests,
    projectRoots: scan.projectRoots,
    modelRegistry,
    ...(scan.env === undefined ? {} : { env: scan.env }),
    ...(input.seams === undefined ? {} : { seams: input.seams }),
  }, (event) => {
    if (event.kind === "step_done" && event.step !== undefined) steps.push(event.step.label)
  })
  if ("kind" in started) return failure(started.reason)
  const { understandId } = started
  const stop = (): void => started.control.stop()
  signal?.addEventListener("abort", stop, { once: true })
  let done: OnboardingUnderstandEvent
  try {
    done = await started.finished
  } finally {
    signal?.removeEventListener("abort", stop)
  }
  const candidates = done.candidates ?? []
  runs.set(understandId, candidates)
  const details: OnboardingUnderstandDetails = { understandId, candidates, ...(done.fallback === undefined ? {} : { fallback: done.fallback }) }
  return { content: [{ type: "text", text: formatCandidates(details, steps) }], details }
}

export async function executeOnboardingMemoryApply(input: {
  readonly params: Static<typeof OnboardingMemoryApplyParams>
  readonly ectx: unknown
  readonly runs: Runs
  readonly applier: MemoryFactsApplier | undefined
}): Promise<AgentToolResult<MemoryFactsApplyResponse | undefined>> {
  const { params, ectx, runs } = input
  const candidates = runs.get(params.understand_id)
  if (candidates === undefined) return failure("No open understanding with this id; its facts were already remembered or it never ran.")
  const unknown = params.selected.filter((id) => !candidates.some((candidate) => candidate.id === id))
  if (unknown.length > 0) return failure(`Not candidates of this understanding: ${unknown.join(", ")}. Nothing was written.`)
  const records = candidates.filter((candidate) => params.selected.includes(candidate.id)).map((candidate) => candidate.fact)
  if (records.length === 0) {
    const none: MemoryFactsApplyResponse = { outcome: "no_facts", affectedPaths: [] }
    return { content: [{ type: "text", text: "Nothing selected; nothing was written." }], details: none }
  }
  const { applier } = input
  if (applier === undefined) return failure("Memory is off in this session, so nothing was written.")
  const sessionId = (ectx as unknown as ToolCtx).sessionManager?.getSessionId()
  const response = await applier({ records }, sessionId)
  if ("outcome" in response && response.outcome === "committed") runs.delete(params.understand_id)
  const text = "outcome" in response
    ? response.outcome === "committed"
      ? `Remembered ${records.length} ${records.length === 1 ? "fact" : "facts"} in one memory commit ${response.sha.slice(0, 12)}: ${response.affectedPaths.join(", ")}`
      : `Not written (${response.outcome}).`
    : `Not written: ${response.reason}`
  return { content: [{ type: "text", text }], details: response, ...("kind" in response ? { isError: true } : {}) }
}

function currentModel(ctx: ToolCtx): string | undefined {
  const provider = ctx.model?.provider
  const id = ctx.model?.id
  return typeof provider === "string" && typeof id === "string" ? `${provider}/${id}` : undefined
}

function formatCandidates(details: OnboardingUnderstandDetails, steps: readonly string[]): string {
  const lines = [
    `understanding ${details.understandId}`,
    ...steps.map((step) => `step: ${step}`),
    details.fallback === "scan_only"
      ? "The model could not read the sessions; continue from the scan rows only."
      : `${details.candidates.length} candidate ${details.candidates.length === 1 ? "fact" : "facts"} (nothing is saved yet):`,
    ...details.candidates.map((candidate) => {
      const who = candidate.fact.scope === "person" ? `about ${candidate.fact.person.name}` : "project"
      return `- [${candidate.id}] (${who}, from ${candidate.sources.length} sessions) ${candidate.fact.text}`
    }),
  ]
  return lines.join("\n")
}

function failure<T>(text: string): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details: undefined as T, isError: true }
}
