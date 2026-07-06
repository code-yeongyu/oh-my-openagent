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
export { createInProcessManagedRunner, createRpcManagedRunner } from "./runner"
export type {
  InProcessRunnerLike,
  InProcessSessionContext,
  InProcessSessionContextProvider,
  RpcRunnerLike,
} from "./runner"
export type {
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
  StartResult,
  TaskManager,
  TaskManagerOptions,
} from "./types"
