import { randomUUID } from "node:crypto"

import type { CreateChildSession, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import type { ChildModelRegistry } from "../memory/model-registry-resolver"
import type { SessionDigest } from "./session-history"
import type { OnboardingUnderstandBudgetLimits, OnboardingUnderstandEvent } from "./understand-contract"
import { OnboardingUnderstandingControl } from "./understand-control"
import { runOnboardingUnderstanding } from "./understand-runtime"

export interface OnboardingUnderstandingSeams {
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
  readonly createSession?: CreateChildSession
  readonly budget?: OnboardingUnderstandBudgetLimits
}

export interface OnboardingUnderstandingStart {
  readonly scanId: string
  readonly model: string
  readonly digests: readonly SessionDigest[]
  /** Project roots the scan listed; AGENTS.md is read only inside these. */
  readonly projectRoots: ReadonlySet<string>
  readonly modelRegistry: ChildModelRegistry
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly seams?: OnboardingUnderstandingSeams
}

export interface OnboardingUnderstandingStarted {
  readonly understandId: string
  readonly control: Pick<OnboardingUnderstandingControl, "skip" | "stop">
  readonly finished: Promise<OnboardingUnderstandEvent>
}

export type OnboardingUnderstandingStartResult =
  | OnboardingUnderstandingStarted
  | { readonly kind: "unavailable" | "invalid"; readonly reason: string }

/**
 * The understanding pass behind `omo.onboarding.understand`, shipped in the lazy onboarding-scan sidecar:
 * when the scan has digests, it starts the run on the next macrotask so the caller can answer with the id
 * (and hold the control) before the first event.
 */
export async function startOnboardingUnderstanding(
  input: OnboardingUnderstandingStart,
  emit: (event: OnboardingUnderstandEvent) => void,
): Promise<OnboardingUnderstandingStartResult> {
  if (input.digests.length === 0) return { kind: "unavailable", reason: "This scan found no recent sessions to read." }

  const understandId = randomUUID()
  const control = new OnboardingUnderstandingControl()
  const { scanId, model, modelRegistry, digests, projectRoots } = input
  const startedAt = performance.now()
  let usage = { bytesRead: 0, toolCalls: 0 }
  const tracked = (event: OnboardingUnderstandEvent): void => {
    usage = { bytesRead: event.bytesRead, toolCalls: event.toolCalls }
    emit(event)
  }
  const finished = new Promise((resolve) => setTimeout(resolve, 0))
    .then(() => runOnboardingUnderstanding({
      understandId,
      scanId,
      model,
      digests,
      projectRoots,
      modelRegistry,
      control,
      ...(input.env === undefined ? {} : { env: { ...input.env } }),
      ...input.seams,
    }, tracked))
    .catch((error: unknown): OnboardingUnderstandEvent => {
      const done: OnboardingUnderstandEvent = {
        understandId, scanId, kind: "done", ...usage, elapsedMs: Math.round(performance.now() - startedAt),
        candidates: [], fallback: "scan_only", reason: error instanceof Error ? error.message : String(error),
      }
      emit(done)
      return done
    })
  return { understandId, control, finished }
}
