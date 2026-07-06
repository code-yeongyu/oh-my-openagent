export { RpcProcessRunner } from "./rpc-process"
export type { RpcProcessRunnerOptions } from "./rpc-process"
export type {
  ChildEventListener,
  ChildExitFacts,
  ChildExitOutcome,
  ChildHandle,
  RpcChildHandle,
  RpcRunnerSpec,
  RunnerErrorFacts,
  TerminateOptions,
} from "./types"
export { buildRpcSpawn, detectBunBinary, resolveChildSessionDir } from "./rpc/spawn"
export type { RpcSpawnDescriptor, RpcSpawnRuntime } from "./rpc/spawn"
export { classifyChildExit, mapExitOutcomeToError, tailStderr } from "./rpc/exit-mapping"
export type { ChildExitInput } from "./rpc/exit-mapping"
export { terminateRpcChild } from "./rpc/terminate"
export { RpcProtocolClient } from "./rpc/protocol-client"
export type { MalformedLineHandler, RpcProtocolClientOptions } from "./rpc/protocol-client"
export { createRpcChildHandle } from "./rpc/handle"
export type { CreateRpcChildHandleOptions } from "./rpc/handle"
export { RpcCommandError } from "./rpc/errors"
export { buildAutoUiResponse } from "./rpc/ui-auto-answer"
