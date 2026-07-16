export { createTaskManager } from "./manager"
export { TaskConcurrency } from "./concurrency"
export type { TaskConcurrencyConfig } from "./concurrency"
export { decideDepthPolicy } from "./depth-policy"
export type { DepthDecision, DepthPolicyInput } from "./depth-policy"
export { NameRegistry } from "./names"
export type { NameRegistration } from "./names"
export { resolveExecutionMode } from "./execution-mode"
export type { ExecutionMode, ExecutionModeSources } from "./execution-mode"
export { adaptInProcessHandle, adaptRpcHandle } from "./child-handle"
export type { ManagedChildEvent, ManagedChildHandle, ManagedChildListener } from "./child-handle"
export {
  TRANSCRIPT_ASSISTANT_EVENT,
  TRANSCRIPT_TOOL_EVENT,
  logTranscriptEvent,
  subscribeTranscriptLog,
} from "./transcript-log"
export type { TranscriptLogStore } from "./transcript-log"
export { createInProcessManagedRunner, createRpcManagedRunner } from "./runner"
export type {
  InProcessRunnerLike,
  InProcessSessionContext,
  InProcessSessionContextProvider,
  RpcRunnerLike,
} from "./runner"
export { createParentRegistrySessionContext, findModelReference } from "./parent-registry-context"
export type { ChildModelRegistry, ParentModelRegistryResolver } from "./parent-registry-context"
export type {
  AdmitResident,
  ChildPlanner,
  ContinueDelivery,
  ContinueResult,
  ListedTask,
  ListScope,
  ManagedRunner,
  ManagedStartSpec,
  ManagerStartSpec,
  PlanResolution,
  PlanResolutionError,
  ResolvedChildPlan,
  TrustedRespawnLaunch,
  TrustedRespawnLaunchResolver,
  SpawnAdmission,
  StartResult,
  TaskManager,
  TaskManagerOptions,
} from "./types"
