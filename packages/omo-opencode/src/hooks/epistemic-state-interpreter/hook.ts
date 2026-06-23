import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import type { EpistemicThresholds } from "../../config/schema/epistemic-thresholds"
import { log } from "../../shared/logger"
import { classifyEpistemicState } from "./classifier"
import { computeDecay } from "./decay-engine"
import { parseProofArtifact } from "./proof-artifact-parser"
import { checkResurrection } from "./resurrection-engine"
import { assertEpistemicGate, toHydratedConclusions } from "./hook-helpers"
import { resolveThresholds } from "./threshold-provider"
import { storeAnnotations } from "./annotation-store"
import { getHistory, hydrate, incrementSessionInvocationCount, isHydrated, snapshot, updateHistory } from "./history-store"
import { loadPersistedState, persistState } from "./persistence"
import type { PersistedConclusionData, PersistedSessionState } from "./persistence-types"
import { computeTheoryHash } from "./theory-hasher"
import { computeTransition } from "./transition-engine"
import { buildTransitionTable } from "./transition-table"
import type { HistoryEntry } from "./transition-types"
import { getVerdict } from "./verdict-store"
import type { EpistemicAnnotation } from "./types"

export interface EpistemicStateInterpreterConfig {
  epistemic_state_interpreter_enabled: boolean
  epistemic_gate_mode?: EpistemicGateMode
  epistemic_thresholds?: EpistemicThresholds
}

export interface EpistemicStateInterpreterHook {
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>
}

export function createEpistemicStateInterpreterHook(config: EpistemicStateInterpreterConfig): EpistemicStateInterpreterHook {
  return {
    "tool.execute.before": async (input): Promise<void> => {
      if (!config.epistemic_state_interpreter_enabled) return

      try {
        const key = `${input.sessionID}:${input.callID}`
        const verdict = getVerdict(key)

        if (!verdict) {
          log("[epistemic] no verdict found", {
            sessionID: input.sessionID,
            tool: input.tool,
            callID: input.callID,
          })
          return
        }

        const currentInvocation = incrementSessionInvocationCount(input.sessionID)
        const theory =
          verdict.proofArtifact && typeof verdict.proofArtifact === "object" && "theory" in verdict.proofArtifact
            ? verdict.proofArtifact.theory
            : undefined
        const currentTheoryHash = computeTheoryHash(theory)
        const thresholds = resolveThresholds(config)
        const table = buildTransitionTable(thresholds)

        const parsed = parseProofArtifact(verdict.proofArtifact)

        if (!parsed) {
          log("[epistemic] failed to parse proof artifact", {
            sessionID: input.sessionID,
            tool: input.tool,
            callID: input.callID,
          })
          return
        }

        if (!isHydrated(input.sessionID)) {
          const persisted = loadPersistedState(input.sessionID)
          hydrate(input.sessionID, persisted ? toHydratedConclusions(persisted) : {})
        }

        const annotations: EpistemicAnnotation[] = []
        const now = Date.now()

        for (const [conclusion, parsedConclusion] of parsed.conclusions) {
          const rawClassification = classifyEpistemicState({
            status: parsedConclusion.status,
            extensionsIn: parsedConclusion.extensionsIn,
            extensionsTotal: parsed.extensionCount,
            proofChainKind: parsedConclusion.proofChainKind,
            hasResidualDefeasibleSupport: parsedConclusion.hasResidualDefeasibleSupport,
          })

          const existingHistory = getHistory(input.sessionID, conclusion)
          const currentState = existingHistory?.currentState === "excluded"
            && checkResurrection({
              currentState: "excluded",
              exclusionTheoryHash: existingHistory.exclusionTheoryHash,
              currentTheoryHash,
            }).shouldResurrect
            ? "open"
            : existingHistory?.currentState ?? rawClassification
          const consecutiveCount = existingHistory
            ? rawClassification === existingHistory.lastClassification
              ? existingHistory.consecutiveCount + 1
              : 1
            : 1

          const { newState } = computeTransition({
            currentState,
            newClassification: rawClassification,
            consecutiveCount,
            history: existingHistory?.entries ?? [],
          }, table)

          const entry: HistoryEntry = {
            classification: rawClassification,
            timestamp: now,
            callID: input.callID,
          }

          updateHistory(input.sessionID, conclusion, entry, newState, currentInvocation, {
            exclusionTheoryHash: newState === "excluded" ? currentTheoryHash : undefined,
          })

          const annotation: EpistemicAnnotation = {
            conclusion,
            state: newState,
            rawClassification,
            reason: `status=${parsedConclusion.status} extensions=${parsedConclusion.extensionsIn}/${parsed.extensionCount}`,
            timestamp: now,
            callID: input.callID,
            proofChainKind: parsedConclusion.proofChainKind,
            extensionMembership: {
              inCount: parsedConclusion.extensionsIn,
              totalCount: parsed.extensionCount,
            },
          }

          annotations.push(annotation)

          log("[epistemic] annotation updated", {
            sessionID: input.sessionID,
            conclusion,
            state: newState,
            rawClassification,
            proofChainKind: parsedConclusion.proofChainKind,
            callID: input.callID,
          })
        }

        storeAnnotations(input.sessionID, annotations)

        assertEpistemicGate(annotations, config.epistemic_gate_mode)

        const allHistory = snapshot(input.sessionID)
        const presentConclusions = new Set(annotations.map((annotation) => annotation.conclusion))
        for (const [conclusion, history] of Object.entries(allHistory)) {
          if (presentConclusions.has(conclusion)) continue

          const decay = computeDecay({
            currentState: history.currentState,
            lastSeenInvocation: history.lastSeenInvocation ?? 0,
            currentInvocation,
            decayThreshold: thresholds.T,
          })

          if (!decay.decayed) continue

          updateHistory(input.sessionID, conclusion, {
            classification: decay.newState,
            timestamp: now,
            callID: input.callID,
          }, decay.newState, currentInvocation)
        }

        const sessionData: PersistedSessionState = {
          sessionID: input.sessionID,
          updatedAt: Date.now(),
          conclusions: snapshot(input.sessionID) as Record<string, PersistedConclusionData>,
        }

        persistState(input.sessionID, sessionData)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("[epistemic gate]")) throw error
        log("[epistemic] annotation pipeline failed - continuing", {
          sessionID: input.sessionID,
          tool: input.tool,
          callID: input.callID,
          error: String(error),
        })
      }
    },
  }
}
