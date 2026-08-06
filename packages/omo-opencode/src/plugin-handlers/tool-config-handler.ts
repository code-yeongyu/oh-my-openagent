import type { OhMyOpenCodeConfig } from "../config";
import { getAgentDisplayName, getAgentListDisplayName } from "../shared/agent-display-names";
import { isTaskSystemEnabled } from "../shared";
import { getSelectedAgentControlDefinition } from "../tools/agentcontrol/agent-definitions";

type AgentWithPermission = { permission?: Record<string, unknown> };

const TASK_DENIED_SUBAGENT_KEYS = [
  "librarian",
  "explore",
  "oracle",
  "multimodal-looker",
  "metis",
  "momus",
] as const;

function getConfigQuestionPermission(): string | null {
  const configContent = process.env.OPENCODE_CONFIG_CONTENT;
  if (!configContent) return null;
  try {
    const parsed = JSON.parse(configContent);
    return parsed?.permission?.question ?? null;
  } catch (error) {
    if (error instanceof Error) return null;
    return null;
  }
}

function agentByKey(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig?: OhMyOpenCodeConfig,
): AgentWithPermission | undefined {
  return (agentResult[getAgentListDisplayName(key, pluginConfig?.agents)] ?? agentResult[getAgentDisplayName(key, pluginConfig?.agents)] ?? agentResult[key]) as
    | AgentWithPermission
    | undefined;
}

function denyTaskForAgent(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agent = agentByKey(agentResult, key, pluginConfig);
  if (!agent) return;
  agent.permission = { ...agent.permission, task: "deny" };
}

export function applyToolConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  agentResult: Record<string, unknown>;
}): void {
  const taskSystemEnabled = isTaskSystemEnabled(params.pluginConfig)
  const denyTodoTools = taskSystemEnabled
    ? { todowrite: "deny", todoread: "deny" }
    : {}

  const existingPermission = params.config.permission as Record<string, unknown> | undefined;
  const skillDeniedByHost = existingPermission?.skill === "deny";

  params.config.tools = {
    ...(params.config.tools as Record<string, unknown>),
    "grep_app_*": false,
    LspHover: false,
    LspCodeActions: false,
    LspCodeActionResolve: false,
    "task_*": false,
    teammate: false,
    ...(taskSystemEnabled
      ? { todowrite: false, todoread: false }
      : {}),
    ...(skillDeniedByHost
      ? { skill: false, skill_mcp: false }
      : {}),
  };

  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
  const configQuestionPermission = getConfigQuestionPermission();
  const isQuestionDisabledByPlugin = params.pluginConfig.disabled_tools?.includes("question") ?? false;
  const questionPermission =
    isQuestionDisabledByPlugin ? "deny" :
    configQuestionPermission === "deny" ? "deny" :
    isCliRunMode ? "deny" :
    "allow";

  for (const agentKey of TASK_DENIED_SUBAGENT_KEYS) {
    denyTaskForAgent(params.agentResult, agentKey, params.pluginConfig);
  }

  if (process.env.AGENT_CONTROL_ROLE === "worker") {
    const selected = getSelectedAgentControlDefinition();
    const worker = selected
      ? agentByKey(params.agentResult, selected.preset, params.pluginConfig)
      : undefined;
    if (worker) {
      const readOnly = selected?.kind === "explore" || selected?.kind === "plan" || selected?.kind === "research";
      const localSearchDenied = selected?.kind === "research";
      const webDenied = selected?.kind === "explore" || selected?.kind === "plan";
      worker.permission = {
        ...worker.permission,
        Report: "allow",
        Execute: "deny",
        Explore: "deny",
        Plan: "deny",
        Research: "deny",
        Dispatch: "deny",
        Send: "deny",
        List: "deny",
        Collect: "deny",
        Peek: "deny",
        Cancel: "deny",
        agentcontrol: "deny",
        call_omo_agent: "deny",
        task: "deny",
        "task_*": "deny",
        teammate: "deny",
        ...(readOnly ? {
          write: "deny",
          edit: "deny",
          apply_patch: "deny",
          bash: "deny",
          interactive_bash: "deny",
        } : {}),
        ...(localSearchDenied ? {
          grep: "deny",
          glob: "deny",
          "lsp_*": "deny",
        } : {}),
        ...(webDenied ? {
          webfetch: "deny",
          websearch: "deny",
        } : {}),
      };
    }
  }

  const librarian = agentByKey(params.agentResult, "librarian", params.pluginConfig);
  if (librarian) {
    librarian.permission = { ...librarian.permission, "grep_app_*": "allow" };
  }
  const looker = agentByKey(params.agentResult, "multimodal-looker", params.pluginConfig);
  if (looker) {
    looker.permission = { ...looker.permission, task: "deny", look_at: "deny" };
  }
  const atlas = agentByKey(params.agentResult, "atlas", params.pluginConfig);
  if (atlas) {
    atlas.permission = {
      ...atlas.permission,
      task: "allow",
      call_omo_agent: "deny",
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const sisyphus = agentByKey(params.agentResult, "sisyphus", params.pluginConfig);
  if (sisyphus) {
    sisyphus.permission = {
      ...sisyphus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const hephaestus = agentByKey(params.agentResult, "hephaestus", params.pluginConfig);
  if (hephaestus) {
    hephaestus.permission = {
      ...hephaestus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const prometheus = agentByKey(params.agentResult, "prometheus", params.pluginConfig);
  if (prometheus) {
    prometheus.permission = {
      ...prometheus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
      bash: "deny",
      interactive_bash: "deny",
    };
  }
  const junior = agentByKey(params.agentResult, "sisyphus-junior", params.pluginConfig);
  if (junior) {
    junior.permission = {
      ...junior.permission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }

  params.config.permission = {
    webfetch: "allow",
    external_directory: "allow",
    ...(params.config.permission as Record<string, unknown>),
    task: "deny",
  };
}
