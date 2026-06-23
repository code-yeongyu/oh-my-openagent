export { createGrepTools } from "./grep"
export { createGlobTools } from "./glob"
export { createSkillTool } from "./skill"
export { discoverCommandsSync } from "./slashcommand"
export { createSessionManagerTools } from "./session-manager"

export { sessionExists } from "./session-manager/storage"

export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createSkillMcpTool } from "./skill-mcp"
export { createReasonArgueTool, createReasonSolveTool } from "./reasoning-core"
export { createSubmitDeliberationTool } from "./submit-deliberation"

import {
  createBackgroundOutput,
  createBackgroundCancel,
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
export {
  createProbeHypothesisAddTool,
  createProbeRunTool,
  createProbeHypothesisEvidenceTool,
  createProbeHypothesisStatusTool,
  createProbeQuestionAddTool,
  createProbeQuestionStatusTool,
  createProbeExperimentCreateTool,
  createProbeProviderRegisterTool,
  createProbeProviderHealthTool,
  createProbeCaptureGetTool,
  createProbeQuestionListTool,
  createProbeQuestionParkTool,
  createProbeFingerprintRegisterTool,
  createProbeProviderRefreshTool,
  createProbeProviderBootstrapTool,
  createProbeExportTool,
  createProbeAuditLogTool,
  createProbeReplayTool,
  createProbeProviderRotateTool,
  createProbePoolBurnBudgetTool,
  createProbeCanaryLockTool,
  createProbeExperimentRunTool,
  createProbeExperimentStatusTool,
  createProbeExperimentAbortTool,
  createProbeCaptureDiffTool,
  createProbeMetricsGetTool,
  createProbeFingerprintVerifyTool,
  createProbeFingerprintMatrixTool,
  createProbeReplayChainTool,
  createProbeHypothesisSupersedeTool,
  createProbeHypothesisResurrectTool,
  createProbeAlertsEvaluateTool,
  createProbeRetentionRunTool,
  createProbeCredentialsAutoRotateTool,
  createProbeCifThresholdScanTool,
  createProbeRateLimitScanTool,
} from "./probe-lab"

export function createBackgroundTools(manager: BackgroundManager, client: OpencodeClient): Record<string, ToolDefinition> {
  const outputManager: BackgroundOutputManager = manager
  const cancelClient: BackgroundCancelClient = client
  return {
    background_output: createBackgroundOutput(outputManager, client),
    background_cancel: createBackgroundCancel(manager, cancelClient),
  }
}
