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
export { RpcProcessRunner } from "./rpc-process"
export type { RpcProcessRunnerOptions } from "./rpc-process"
export type {
  ChildEventListener,
  ChildExitFacts,
  ChildExitOutcome,
  RpcChildHandle,
  RpcRunnerSpec,
  RunnerErrorFacts,
  TerminateOptions,
} from "./types"
export { buildChildArgs, buildRpcSpawn, detectBunBinary, resolveChildSessionDir, resolveSenpiExecutable } from "./rpc/spawn"
export type { RpcSpawnDescriptor, RpcSpawnRuntime } from "./rpc/spawn"
export { parseExtensionEntries } from "./rpc/parent-extensions"
export { classifyChildExit, mapExitOutcomeToError, tailStderr } from "./rpc/exit-mapping"
export type { ChildExitInput } from "./rpc/exit-mapping"
export { terminateRpcChild } from "./rpc/terminate"
export { RpcProtocolClient } from "./rpc/protocol-client"
export type { MalformedLineHandler, RpcProtocolClientOptions } from "./rpc/protocol-client"
export { createRpcChildHandle } from "./rpc/handle"
export type { CreateRpcChildHandleOptions } from "./rpc/handle"
export { RpcCommandError } from "./rpc/errors"
export { buildAutoUiResponse } from "./rpc/ui-auto-answer"
