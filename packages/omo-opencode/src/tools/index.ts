export { createGrepTools } from "./grep"
export { createGlobTools } from "./glob"
export { createSkillTool } from "./skill"
export { discoverCommandsSync } from "./slashcommand"
export { createSessionManagerTools } from "./session-manager"

export { sessionExists } from "./session-manager/storage"

export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createSkillMcpTool } from "./skill-mcp"

import {
  createBackgroundOutput,
  createBackgroundCancel,
  createWaitForBackgroundTasks,
  type BackgroundOutputManager,
  type BackgroundCancelClient,
} from "./background-task"

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"

type OpencodeClient = PluginInput["client"]

export { createCallOmoAgent } from "./call-omo-agent"
export { createLookAt } from "./look-at"
export { createMonitorTools } from "./monitor"
export { createDelegateTask } from "./delegate-task"
export {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "./task"
export { createHashlineEditTool } from "./hashline-edit"
export { createTeamSendMessageTool } from "../features/team-mode/tools/messaging"

export function createBackgroundTools(
  manager: BackgroundManager,
  client: OpencodeClient,
  options?: { blockOnBackgroundTasks?: boolean },
): Record<string, ToolDefinition> {
  const outputManager: BackgroundOutputManager = manager
  const cancelClient: BackgroundCancelClient = client
  const tools: Record<string, ToolDefinition> = {
    background_output: createBackgroundOutput(outputManager, client),
    background_cancel: createBackgroundCancel(manager, cancelClient),
  }
  if (options?.blockOnBackgroundTasks) {
    tools["wait-for-background-tasks"] = createWaitForBackgroundTasks(manager)
  }
  return tools
}
