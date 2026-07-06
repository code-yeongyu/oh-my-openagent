export {
  DEFAULT_MAX_CHILD_DEPTH,
  InProcessRunner,
  RunnerError,
  filterSharedParentTools,
  isTaskOrTeamFamilyTool,
  mergeChildCustomTools,
} from "./in-process"
export type {
  ChildHandle,
  ChildSession,
  ChildSessionEvent,
  ChildSessionListener,
  ChildSpec,
  CreateChildSession,
  DepthPolicy,
  InProcessRunnerOptions,
  RunnerFailure,
  RunnerOutcome,
  SharedToolFilterOptions,
} from "./in-process"
export { buildSubagentPrompt, type SubagentPromptInput } from "./in-process/subagent-prompt"
export { createChildResourceLoader } from "./in-process/child-loader"
