import type { AgentConfig } from "@opencode-ai/sdk";
import { applyOverrides } from "../agents/builtin-agents/agent-overrides";
import type { AgentOverrideConfig } from "../agents/types";
import type { OhMyOpenCodeConfig } from "../config";
import { getAgentConfigKey } from "../shared/agent-display-names";
import { AGENT_NAME_MAP } from "../shared/migration";
import { mergeCategories } from "../shared/merge-categories";

const RESERVED_AGENT_KEYS = new Set(
  [
    "build",
    "plan",
    "sisyphus-junior",
    "opencode-builder",
    ...Object.keys(AGENT_NAME_MAP),
    ...Object.values(AGENT_NAME_MAP),
  ].map((key) => getAgentConfigKey(key).toLowerCase()),
);

export type AgentSummary = {
  name: string;
  description: string;
  hidden?: boolean;
  disabled?: boolean;
  enabled?: boolean;
};

export function applyCustomAgentOverrides(params: {
  mergedAgents: Record<string, unknown>;
  userOverrides: OhMyOpenCodeConfig["custom_agents"] | undefined;
  builtinOverrideKeys: Set<string>;
  mergedCategories: ReturnType<typeof mergeCategories>;
  directory: string;
}): void {
  if (!params.userOverrides) return;

  for (const [overrideKey, override] of Object.entries(params.userOverrides)) {
    if (!override) continue;

    const normalizedOverrideKey = getAgentConfigKey(overrideKey).toLowerCase();
    if (params.builtinOverrideKeys.has(normalizedOverrideKey)) continue;

    const existingKey = Object.keys(params.mergedAgents).find(
      (key) => key.toLowerCase() === overrideKey.toLowerCase() || key.toLowerCase() === normalizedOverrideKey,
    );
    if (!existingKey) continue;

    const existingAgent = params.mergedAgents[existingKey];
    if (!existingAgent || typeof existingAgent !== "object") continue;

    params.mergedAgents[existingKey] = applyOverrides(
      existingAgent as AgentConfig,
      override as AgentOverrideConfig,
      params.mergedCategories,
      params.directory,
    );
  }
}

export function collectCustomAgentSummariesFromRecord(
  agents: Record<string, unknown> | undefined,
): AgentSummary[] {
  if (!agents) return [];

  const summaries: AgentSummary[] = [];
  for (const [name, value] of Object.entries(agents)) {
    const normalizedName = getAgentConfigKey(name).toLowerCase();
    if (RESERVED_AGENT_KEYS.has(normalizedName)) continue;
    if (!value || typeof value !== "object") continue;

    const agentValue = value as Record<string, unknown>;
    const description = typeof agentValue.description === "string" ? agentValue.description : "";

    summaries.push({
      name,
      description,
      hidden: typeof agentValue.hidden === "boolean" ? agentValue.hidden : undefined,
      disabled: typeof agentValue.disabled === "boolean" ? agentValue.disabled : undefined,
      enabled: typeof agentValue.enabled === "boolean" ? agentValue.enabled : undefined,
    });
  }

  return summaries;
}

export function mergeCustomAgentSummaries(...summaryGroups: AgentSummary[][]): AgentSummary[] {
  const merged = new Map<string, AgentSummary>();

  for (const group of summaryGroups) {
    for (const summary of group) {
      const key = summary.name.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, summary);
        continue;
      }

      const existing = merged.get(key);
      if (!existing) continue;

      const existingDescription = existing.description.trim();
      const incomingDescription = summary.description.trim();

      merged.set(key, {
        ...existing,
        ...summary,
        hidden: summary.hidden ?? existing.hidden,
        disabled: summary.disabled ?? existing.disabled,
        enabled: summary.enabled ?? existing.enabled,
        description: incomingDescription || existingDescription,
      });
    }
  }

  return Array.from(merged.values());
}

export function collectKnownCustomAgentNames(
  ...agentGroups: Array<Record<string, unknown> | undefined>
): Set<string> {
  const knownNames = new Set<string>();

  for (const group of agentGroups) {
    if (!group) continue;

    for (const [name, value] of Object.entries(group)) {
      const normalizedName = getAgentConfigKey(name).toLowerCase();
      if (RESERVED_AGENT_KEYS.has(normalizedName)) continue;
      if (!value || typeof value !== "object") continue;

      knownNames.add(normalizedName);
    }
  }

  return knownNames;
}

export function filterSummariesByKnownNames(
  summaries: AgentSummary[],
  knownNames: Set<string>,
): AgentSummary[] {
  return summaries.filter((summary) => knownNames.has(summary.name.toLowerCase()));
}
