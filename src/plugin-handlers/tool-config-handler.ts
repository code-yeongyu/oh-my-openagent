import type { MatrixxConfig } from "../config";

type AgentWithPermission = { permission?: Record<string, unknown> };

export function applyToolConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: MatrixxConfig;
  agentResult: Record<string, unknown>;
}): void {
  const denyTodoTools = params.pluginConfig.experimental?.task_system
    ? { todowrite: "deny", todoread: "deny" }
    : {}

  params.config.tools = {
    ...(params.config.tools as Record<string, unknown>),
    "grep_app_*": false,
    LspHover: false,
    LspCodeActions: false,
    LspCodeActionResolve: false,
    "task_*": false,
    teammate: false,
    ...(params.pluginConfig.experimental?.task_system
      ? { todowrite: false, todoread: false }
      : {}),
  };

  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
  const questionPermission = isCliRunMode ? "deny" : "allow";

  if (params.agentResult.operator) {
    const agent = params.agentResult.operator as AgentWithPermission;
    agent.permission = { ...agent.permission, "grep_app_*": "allow" };
  }
  if (params.agentResult["construct"]) {
    const agent = params.agentResult["construct"] as AgentWithPermission;
    agent.permission = { ...agent.permission, task: "deny", look_at: "deny" };
  }
  if (params.agentResult["architect"]) {
    const agent = params.agentResult["architect"] as AgentWithPermission;
    agent.permission = {
      ...agent.permission,
      task: "allow",
      call_omo_agent: "deny",
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  if (params.agentResult.morpheus) {
    const agent = params.agentResult.morpheus as AgentWithPermission;
    agent.permission = {
      ...agent.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  if (params.agentResult.keymaker) {
    const agent = params.agentResult.keymaker as AgentWithPermission;
    agent.permission = {
      ...agent.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      ...denyTodoTools,
    };
  }
  if (params.agentResult["oracle"]) {
    const agent = params.agentResult["oracle"] as AgentWithPermission;
    agent.permission = {
      ...agent.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  if (params.agentResult["mouse"]) {
    const agent = params.agentResult["mouse"] as AgentWithPermission;
    agent.permission = {
      ...agent.permission,
      task: "allow",
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }

  params.config.permission = {
    ...(params.config.permission as Record<string, unknown>),
    webfetch: "allow",
    external_directory: "allow",
    task: "deny",
  };
}
