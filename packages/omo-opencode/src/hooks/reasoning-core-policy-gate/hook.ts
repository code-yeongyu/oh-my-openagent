import type { Hooks } from "@opencode-ai/plugin";
import { storeVerdict } from "../epistemic-state-interpreter/verdict-store";
import { getSessionAgent } from "../../features/claude-code-session-state";
import { getAgentConfigKey } from "../../shared/agent-display-names";
import { log } from "../../shared/logger";
import {
  createReasoningCoreClient,
  type ReasoningCoreClient,
  type ReasoningCoreClientConfig,
} from "./reasoning-core-client";
import { ReasoningCoreInfrastructureError } from "./client/infrastructure-error";
import { normalizeCandidateAction } from "./normalizer";
import {
  evaluatePrometheusPlanningGate,
  isPrometheusPlanningGateCandidate,
} from "./prometheus-metis-gate";
import { writeAllowedConsultationPattern } from "./prometheus-metis-kb-writer";
import {
  evaluatePrometheusMomusGate,
  isPrometheusMomusGateCandidate,
} from "./prometheus-momus-gate";
import { writeAllowedMomusPattern } from "./prometheus-momus-kb-writer";
import {
  evaluatePrometheusPlanWriteGate,
  isPrometheusPlanWriteGateCandidate,
} from "./prometheus-plan-write-gate";
import { isReasoningCoreInfrastructureError } from "./reasoning-core-infrastructure-error";
import { writeAllowedPlanPattern } from "./prometheus-plan-kb-writer";
import type { ReasoningCorePolicyGateHook } from "./types";
import { evaluateDestructiveAction } from "./destructive-action-gate";

export type InfrastructureFailMode = "open" | "closed";

export interface ReasoningCorePolicyGateHookConfig
  extends ReasoningCoreClientConfig {
  client?: ReasoningCoreClient;
  workspaceRoot?: string;
  infrastructureFailMode?: InfrastructureFailMode;
}

export function createReasoningCorePolicyGateHook(
  config?: ReasoningCorePolicyGateHookConfig,
): ReasoningCorePolicyGateHook {
  const client = config?.client ?? createReasoningCoreClient(config);
  const workspaceRoot = config?.workspaceRoot ?? process.cwd();
  const infrastructureFailMode: InfrastructureFailMode =
    config?.infrastructureFailMode ?? "open";
  const sessionActionHistory = new Map<
    string,
    ReturnType<typeof normalizeCandidateAction>[]
  >();

  function rememberCandidate(
    sessionID: string,
    candidate: ReturnType<typeof normalizeCandidateAction>,
  ): void {
    const existing = sessionActionHistory.get(sessionID) ?? [];
    const next = [...existing, candidate].slice(-50);
    sessionActionHistory.set(sessionID, next);
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const sessionAgent = getSessionAgent(input.sessionID);
      const sessionAgentKey = sessionAgent
        ? getAgentConfigKey(sessionAgent)
        : undefined;
      const candidate = normalizeCandidateAction(
        input.tool,
        input.sessionID,
        output.args,
        sessionAgentKey,
      );
      const toolHistory = sessionActionHistory.get(input.sessionID) ?? [];
      const isPlanWriteCandidate = isPrometheusPlanWriteGateCandidate(
        candidate,
        workspaceRoot,
      );

      const destructiveCheck = await evaluateDestructiveAction(
        client,
        input.tool,
        output.args,
      );
      if (destructiveCheck) {
        const firedRulesSummary = destructiveCheck.fired_rules.length > 0
          ? ` [rules: ${destructiveCheck.fired_rules.join(", ")}]`
          : "";
        throw new Error(
          `Destructive action blocked: ${destructiveCheck.reason}${firedRulesSummary}`,
        );
      }

      if (isPrometheusPlanningGateCandidate(candidate)) {
        const planningVerdict = await evaluatePrometheusPlanningGate({
          client,
          candidate,
          callID: input.callID,
          toolHistory,
        });

        if (!planningVerdict.allow) {
          throw new Error(
            `Reasoning-core policy gate denied: ${
              planningVerdict.reason ?? "Planning gate rejected"
            }`,
          );
        }

        writeAllowedConsultationPattern({
          client,
          verdict: planningVerdict,
          sessionID: candidate.sessionID,
        }).catch(() => {});
      }

      if (isPrometheusMomusGateCandidate(candidate)) {
        const momusVerdict = await evaluatePrometheusMomusGate({
          client,
          candidate,
          callID: input.callID,
          workspaceRoot,
          toolHistory,
        });

        if (!momusVerdict.allow) {
          throw new Error(
            `Reasoning-core policy gate denied: ${
              momusVerdict.reason ?? "Momus gate rejected"
            }`,
          );
        }

        writeAllowedMomusPattern({
          client,
          verdict: momusVerdict,
          sessionID: candidate.sessionID,
        }).catch(() => {});

        rememberCandidate(input.sessionID, candidate);
        return;
      }

      if (isPlanWriteCandidate) {
        const planWriteVerdict = await evaluatePrometheusPlanWriteGate({
          client,
          candidate,
          callID: input.callID,
          workspaceRoot,
          toolHistory,
          mutationKind: input.tool.toLowerCase() === "edit" ? "edit" : "write",
          infrastructureFailMode,
        });

        if (!planWriteVerdict.allow) {
          throw new Error(
            `Reasoning-core plan write gate denied: ${
              planWriteVerdict.reason ?? "Plan write gate rejected"
            }`,
          );
        }

        if (
          planWriteVerdict.proofArtifact &&
          typeof planWriteVerdict.proofArtifact === "object" &&
          "fallbackAllow" in planWriteVerdict.proofArtifact
        ) {
          rememberCandidate(input.sessionID, candidate);
          return;
        }

        const planFilePath =
          typeof candidate.args.filePath === "string"
            ? candidate.args.filePath
            : typeof candidate.args.path === "string"
            ? candidate.args.path
            : "";
        const planName =
          planFilePath.split("/").pop()?.replace(/\.md$/i, "") ?? "unknown";
        writeAllowedPlanPattern({
          client,
          verdict: planWriteVerdict,
          planName,
          sessionID: candidate.sessionID,
        }).catch(() => {});
      }

      let verdict;
      try {
        // Single-semantics policy verdict (grounded). See
        // docs/adr/007-reasoning-core-polish-boundaries.md.
        verdict = await client.evaluate({
          candidate,
          sessionContext: {},
        });
      } catch (error) {
        if (error instanceof ReasoningCoreInfrastructureError) {
          handleInfrastructureFailure(error, candidate, infrastructureFailMode);
          rememberCandidate(input.sessionID, candidate);
          return;
        }
        throw error;
      }

      storeVerdict(`${input.sessionID}:${input.callID}`, verdict);

      if (!verdict.allow) {
        if (
          isPlanWriteCandidate &&
          isReasoningCoreInfrastructureError(verdict.reason)
        ) {
          rememberCandidate(input.sessionID, candidate);
          return;
        }

        throw new Error(
          `Reasoning-core policy gate denied: ${
            verdict.reason ?? "Policy evaluation failed"
          }`,
        );
      }

      rememberCandidate(input.sessionID, candidate);
    },
  } as Hooks & ReasoningCorePolicyGateHook;
}

function handleInfrastructureFailure(
  error: ReasoningCoreInfrastructureError,
  candidate: ReturnType<typeof normalizeCandidateAction>,
  mode: InfrastructureFailMode,
): void {
  if (mode === "closed") {
    throw new Error(
      `Reasoning-core infrastructure unavailable (${error.kind}): ${error.message}`,
    );
  }
  log("reasoning-core-policy-gate: infrastructure unavailable, allowing action (fail-open)", {
    kind: error.kind,
    message: error.message,
    tool: candidate.tool,
    sessionID: candidate.sessionID,
  });
}
