import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import type { ChildHandle as InProcessChildHandle } from "../runners/in-process/child-handle"
import type { ChildSpec } from "../runners/in-process"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { adaptInProcessHandle, adaptRpcHandle, type ManagedChildHandle } from "./child-handle"
import type { ManagedRunner, ManagedStartSpec } from "./types"

// The senpi-typed per-child context the component (todo 17) supplies: it owns agent-dir resolution
// and the parent's auth/model registry, which the string-typed ManagedStartSpec cannot carry.
export type InProcessSessionContext = {
  readonly agentDir?: string
  readonly authStorage?: CreateAgentSessionOptions["authStorage"]
  readonly modelRegistry?: CreateAgentSessionOptions["modelRegistry"]
  readonly model?: CreateAgentSessionOptions["model"]
  readonly thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"]
}

export type InProcessSessionContextProvider = (spec: ManagedStartSpec) => InProcessSessionContext

export type InProcessRunnerLike = {
  start(spec: ChildSpec): Promise<InProcessChildHandle>
}

export type RpcRunnerLike = {
  start(spec: RpcRunnerSpec): RpcChildHandle
}

export function createInProcessManagedRunner(
  runner: InProcessRunnerLike,
  context: InProcessSessionContextProvider = () => ({}),
): ManagedRunner {
  return {
    async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
      const childSpec = toChildSpec(spec, context(spec))
      return adaptInProcessHandle(await runner.start(childSpec))
    },
  }
}

export function createRpcManagedRunner(runner: RpcRunnerLike): ManagedRunner {
  return {
    start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
      const rpcSpec: RpcRunnerSpec = {
        task_id: spec.taskId,
        cwd: spec.cwd,
        state_dir: spec.stateDir,
        prompt: spec.prompt,
        // A detached rpc child cannot share the parent's in-memory model registry; thread the resolved
        // provider/modelId so the child resolves the requested model on its own command line.
        ...(spec.model !== undefined ? { model: spec.model } : {}),
        ...(spec.variant !== undefined ? { variant: spec.variant } : {}),
        ...(spec.extensions !== undefined ? { extensions: spec.extensions } : {}),
        ...(spec.memberEnv !== undefined ? { memberEnv: spec.memberEnv } : {}),
      }
      return Promise.resolve(adaptRpcHandle(runner.start(rpcSpec)))
    },
  }
}

function toChildSpec(spec: ManagedStartSpec, context: InProcessSessionContext): ChildSpec {
  return {
    taskId: spec.taskId,
    cwd: spec.cwd,
    depth: spec.depth,
    parentSessionId: spec.parentSessionId,
    rootSessionId: spec.rootSessionId,
    prompt: spec.prompt,
    ...(context.agentDir !== undefined ? { agentDir: context.agentDir } : {}),
    ...(context.authStorage !== undefined ? { authStorage: context.authStorage } : {}),
    ...(context.modelRegistry !== undefined ? { modelRegistry: context.modelRegistry } : {}),
    ...(context.model !== undefined ? { model: context.model } : {}),
    ...(context.thinkingLevel !== undefined ? { thinkingLevel: context.thinkingLevel } : {}),
    ...(spec.agentType !== undefined ? { agentType: spec.agentType } : {}),
    ...(spec.instructions !== undefined ? { instructions: spec.instructions } : {}),
    ...(spec.toolAllowlist !== undefined ? { toolAllowlist: spec.toolAllowlist } : {}),
    ...(spec.memberScopedTools !== undefined ? { memberScopedTools: spec.memberScopedTools } : {}),
  }
}
