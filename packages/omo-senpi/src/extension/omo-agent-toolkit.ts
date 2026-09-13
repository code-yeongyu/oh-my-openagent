// Lazy runtime bundle for the ULW toolkit tool and SDK. The main extension keeps both out of its
// own artifact (bundle-size budget) and reaches them through "#omo-agent-toolkit-runtime", exactly
// like the task engine reaches "#omo-task-runtime".
export {
  AGENT_TOOLKIT_TOOL_NAME,
  createAgentToolkitTool,
  executeAgentToolkit,
  STEERING_KINDS,
} from "../components/ulw-loop/agent-toolkit-tool-exec"
export type { AgentToolkitToolDeps, AgentToolkitToolResult } from "../components/ulw-loop/agent-toolkit-tool-exec"
export { createAgentToolkit } from "../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
