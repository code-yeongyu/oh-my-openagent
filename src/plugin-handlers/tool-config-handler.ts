import type { MatrixxConfig } from "../config";

type AgentWithPermission = { permission?: Record<string, unknown> };

function agentByKey(agentResult: Record<string, unknown>, key: string): AgentWithPermission | undefined {
  return agentResult[key] as AgentWithPermission | undefined;
}

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

  const operator = agentByKey(params.agentResult, "operator");
  if (operator) {
    operator.permission = { ...operator.permission, "grep_app_*": "allow" };
  }
  const construct = agentByKey(params.agentResult, "construct");
  if (construct) {
    construct.permission = { ...construct.permission, task: "deny", look_at: "deny" };
  }
  const architect = agentByKey(params.agentResult, "architect");
  if (architect) {
    architect.permission = {
      ...architect.permission,
      task: "allow",
      delegate_agent: "deny",
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const morpheus = agentByKey(params.agentResult, "morpheus");
  if (morpheus) {
    morpheus.permission = {
      ...morpheus.permission,
      delegate_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const keymaker = agentByKey(params.agentResult, "keymaker");
  if (keymaker) {
    keymaker.permission = {
      ...keymaker.permission,
      delegate_agent: "deny",
      task: "allow",
      question: questionPermission,
      ...denyTodoTools,
    };
  }
  const oracle = agentByKey(params.agentResult, "oracle");
  if (oracle) {
    oracle.permission = {
      ...oracle.permission,
      delegate_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const mouse = agentByKey(params.agentResult, "mouse");
  if (mouse) {
    mouse.permission = {
      ...mouse.permission,
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
