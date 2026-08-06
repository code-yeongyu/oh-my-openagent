import {
  clearRegisteredAgentNames,
  registerAgentName,
} from "../features/claude-code-session-state";
import { log } from "../shared";
import { setDefaultAgentForSort } from "../shared/agent-sort-shim";
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper";
import { reorderAgentsByPriority } from "./agent-priority-order";
import type { ApplyAgentConfigParams } from "./agent-config-types";
import { getSelectedAgentControlDefinition } from "../tools/agentcontrol/agent-definitions";

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAgentControlWorkerContract(): string | undefined {
  const selected = getSelectedAgentControlDefinition();
  const name = process.env.AGENT_CONTROL_NAME?.trim();
  const reportPath = process.env.AGENT_CONTROL_REPORT_PATH?.trim();
  if (!selected || !name || !reportPath) return undefined;
  const worktree = process.env.AGENT_CONTROL_WORKTREE?.trim();
  const branch = process.env.AGENT_CONTROL_BRANCH?.trim();
  const runtime = {
    name,
    kind: selected.kind,
    reportPath,
    ...(worktree ? { worktree } : {}),
    ...(branch ? { branch } : {}),
  };
  const runtimeJson = JSON.stringify(runtime)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return `<agentcontrol-worker-contract>
You are an AgentControl ${selected.kind} worker. For each leader request, call Report exactly once. Keep summary to one conclusion of at most 600 characters. Put longer Markdown in details; AgentControl writes it to reportPath. When branch is present, commit task changes and include the branch name in summary.
<runtime-json>${runtimeJson}</runtime-json>
</agentcontrol-worker-contract>`;
}

function exposeSelectedAgentControlWorker(config: Record<string, unknown>): void {
  if (process.env.AGENT_CONTROL_ROLE !== "worker") return;
  const selected = getSelectedAgentControlDefinition();
  if (!selected) return;
  const agents = config.agent;
  if (!isUnknownRecord(agents)) return;
  const selectedConfig = agents[selected.preset];
  if (!isUnknownRecord(selectedConfig)) return;
  const contract = buildAgentControlWorkerContract();
  const prompt = typeof selectedConfig.prompt === "string" ? selectedConfig.prompt : "";
  agents[selected.preset] = {
    ...selectedConfig,
    mode: "all",
    ...(contract ? { prompt: prompt ? `${prompt}\n\n${contract}` : contract } : {}),
  };
}

export function finalizeAgentConfig(
  params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig"> & {
    configuredDefaultAgent: string | undefined;
  },
): Record<string, unknown> {
  exposeSelectedAgentControlWorker(params.config);
  if (params.config.agent) {
    params.config.agent = remapAgentKeysToDisplayNames(
      params.config.agent as Record<string, unknown>,
      params.pluginConfig.agents as Record<string, { displayName?: string } | undefined> | undefined,
    );
    params.config.agent = reorderAgentsByPriority(
      params.config.agent as Record<string, unknown>,
      params.pluginConfig.agent_order,
    );
  }

  if (params.configuredDefaultAgent) {
    setDefaultAgentForSort(
      (params.config as { default_agent?: string }).default_agent ?? params.configuredDefaultAgent,
    );
  }

  const agentResult =
    params.config.agent != null ? (params.config.agent as Record<string, unknown>) : {};
  clearRegisteredAgentNames();
  for (const name of Object.keys(agentResult)) {
    registerAgentName(name);
  }
  log("[config-handler] agents loaded", { agentKeys: Object.keys(agentResult) });
  return agentResult;
}
