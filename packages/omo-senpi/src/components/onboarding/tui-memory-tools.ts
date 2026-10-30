import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { type Static, Type } from "typebox"

import { sessionFactsApplier, type MemoryFactsApplyResponse } from "../memory/facts-apply-rpc"
import type { SessionDigest } from "./session-history"
import type { OnboardingFactCandidate } from "./understand-contract"
import type { OnboardingUnderstandingSeams } from "./understand-start"
import type { executeOnboardingMemoryApply, executeOnboardingUnderstand } from "./tui-memory-runtime"

export const ONBOARDING_UNDERSTAND_TOOL_NAME = "onboarding_understand"
export const ONBOARDING_MEMORY_APPLY_TOOL_NAME = "onboarding_memory_apply"

export interface TuiOnboardingScan {
  readonly scanId: string
  /** The scan's session digests, held in memory only; nothing of the scan is on disk. */
  readonly digests: readonly SessionDigest[]
  /** Project roots the scan listed; understanding reads AGENTS.md only inside these. */
  readonly projectRoots: ReadonlySet<string>
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface TuiMemoryToolsRuntime {
  readonly executeOnboardingUnderstand: typeof executeOnboardingUnderstand
  readonly executeOnboardingMemoryApply: typeof executeOnboardingMemoryApply
}

export interface TuiMemoryToolsOptions {
  readonly scan: () => Promise<TuiOnboardingScan | undefined>
  readonly loadRuntime: () => Promise<TuiMemoryToolsRuntime>
  readonly seams?: OnboardingUnderstandingSeams
}

export const OnboardingUnderstandParams = Type.Object(
  {
    consent: Type.Optional(Type.Boolean()),
    model: Type.Optional(Type.String({ minLength: 3 })),
  },
  { additionalProperties: false },
)
export const OnboardingMemoryApplyParams = Type.Object(
  {
    understand_id: Type.String({ minLength: 1 }),
    selected: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)

export interface OnboardingUnderstandDetails {
  readonly understandId: string
  readonly candidates: readonly OnboardingFactCandidate[]
  readonly fallback?: "scan_only"
}

/**
 * TUI side of "understanding you": the same `startOnboardingUnderstanding` the `omo.onboarding.understand` RPC
 * runs, then the user's selection written through `omo.memory.facts.apply`'s applier. Candidates are held
 * in memory only; nothing reaches memory until a selection names them. The tools' bodies ship in the lazy
 * onboarding-scan sidecar (`tui-memory-runtime.ts`); this shell carries only their definitions.
 */
export function createOnboardingMemoryTools(options: TuiMemoryToolsOptions): {
  readonly understand: ToolDefinition<typeof OnboardingUnderstandParams, OnboardingUnderstandDetails>
  readonly apply: ToolDefinition<typeof OnboardingMemoryApplyParams, MemoryFactsApplyResponse | undefined>
} {
  const runs = new Map<string, readonly OnboardingFactCandidate[]>()
  const runtime = async (): Promise<TuiMemoryToolsRuntime | string> => {
    try {
      return await options.loadRuntime()
    } catch (error) {
      return `The onboarding runtime could not load (${error instanceof Error ? error.message : String(error)}); continue with the scan rows only.`
    }
  }

  const understand: ToolDefinition<typeof OnboardingUnderstandParams, OnboardingUnderstandDetails> = {
    name: ONBOARDING_UNDERSTAND_TOOL_NAME,
    label: "Understand you from session history",
    description:
      "Onboarding: reads the onboarding scan's session digests with the model and proposes facts about the user and their projects. " +
      "Sends digests to the model provider, so call it only after the user agreed, with consent: true. " +
      "consent: true is your statement that the user explicitly agreed in this conversation; the tool cannot verify it, " +
      "so never set it on your own initiative or from an earlier, unrelated yes. Without it nothing is read or sent. Writes nothing; " +
      "show the candidates and let the user pick, then call onboarding_memory_apply with the picked ids.",
    parameters: OnboardingUnderstandParams,
    exposure: "search",
    searchGroup: "onboarding",
    searchKeywords: ["onboarding", "understanding", "memory candidates", "facts"],
    allowLazyActivation: true,
    executionMode: "sequential",
    async execute(_toolCallId, params: Static<typeof OnboardingUnderstandParams>, signal, _onUpdate, ectx): Promise<AgentToolResult<OnboardingUnderstandDetails>> {
      if (params.consent !== true) return failure("Ask the user first: understanding sends session digests to the model provider. Call again with consent: true once they agree.")
      const loaded = await runtime()
      if (typeof loaded === "string") return failure(loaded)
      return loaded.executeOnboardingUnderstand({ params, signal, ectx, runs, scan: options.scan, ...(options.seams === undefined ? {} : { seams: options.seams }) })
    },
  }

  const apply: ToolDefinition<typeof OnboardingMemoryApplyParams, MemoryFactsApplyResponse | undefined> = {
    name: ONBOARDING_MEMORY_APPLY_TOOL_NAME,
    label: "Remember the selected facts",
    description:
      "Onboarding: writes ONLY the candidate facts the user selected from onboarding_understand into memory, through the engine's " +
      "facts writer (one commit). Unselected candidates are never written. Pass the understand_id and the selected candidate ids.",
    parameters: OnboardingMemoryApplyParams,
    exposure: "search",
    searchGroup: "onboarding",
    searchKeywords: ["onboarding", "remember", "memory", "facts"],
    allowLazyActivation: true,
    executionMode: "sequential",
    async execute(_toolCallId, params: Static<typeof OnboardingMemoryApplyParams>, _signal, _onUpdate, ectx): Promise<AgentToolResult<MemoryFactsApplyResponse | undefined>> {
      const loaded = await runtime()
      if (typeof loaded === "string") return failure(loaded)
      return loaded.executeOnboardingMemoryApply({ params, ectx, runs, applier: sessionFactsApplier() })
    },
  }
  return { understand, apply }
}

function failure<T>(text: string): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details: undefined as T, isError: true }
}
