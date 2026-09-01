import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import type { ChildHandle as InProcessChildHandle } from "../runners/in-process/child-handle"
import { RunnerError, type ChildSpec } from "../runners/in-process"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { adaptInProcessHandle, adaptRpcHandle, type ManagedChildHandle } from "./child-handle"
import type { ManagedRunner, ManagedStartSpec } from "./types"

// The senpi-typed per-child context the component (todo 17) supplies: it owns agent-dir resolution
// and the parent's auth/model registry, which the string-typed ManagedStartSpec cannot carry.
export type InProcessSessionContext = {
  readonly agentDir?: string
  readonly authStorage?: CreateAgentSessionOptions["authStorage"]
  readonly modelRegistry?: CreateAgentSessionOptions["modelRegistry"]
  readonly modelRuntime?: ChildSpec["modelRuntime"]
  readonly model?: CreateAgentSessionOptions["model"]
  readonly thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"]
}

export type ResumeSessionContextResult =
  | { readonly ok: true; readonly context: InProcessSessionContext }
  | { readonly ok: false; readonly code: "model_unavailable"; readonly reason: string }

export type InProcessSessionContextProvider = ((spec: ManagedStartSpec) => InProcessSessionContext) & {
  readonly resolveResumeContext?: (spec: ManagedStartSpec) => ResumeSessionContextResult
}

export type InProcessRunnerLike = {
  start(spec: ChildSpec): Promise<InProcessChildHandle>
  resume?(spec: ChildSpec, sessionPath: string): Promise<InProcessChildHandle>
}

export type RpcRunnerLike = {
  start(spec: RpcRunnerSpec): Promise<RpcChildHandle>
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
    async resume(spec: ManagedStartSpec, sessionPath: string): Promise<ManagedChildHandle> {
      const resolved = context.resolveResumeContext?.(spec)
      if (resolved !== undefined && !resolved.ok) {
        throw new RunnerError({ kind: resolved.code, message: resolved.reason })
      }
      if (runner.resume === undefined) {
        throw new RunnerError({ kind: "session_unavailable", message: "in-process runner cannot resume sessions" })
      }
      const childSpec = toChildSpec(spec, resolved?.context ?? context(spec))
      return adaptInProcessHandle(await runner.resume(childSpec, sessionPath))
    },
  }
}

export function createRpcManagedRunner(runner: RpcRunnerLike): ManagedRunner {
  return {
    async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
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
      return adaptRpcHandle(await runner.start(rpcSpec))
    },
  }
}

function toChildSpec(spec: ManagedStartSpec, context: InProcessSessionContext): ChildSpec {
  return {
    taskId: spec.taskId,
    cwd: spec.cwd,
    // ManagedStartSpec.stateDir is already join(stateDir, "children", taskId); the session dir
    // nests sessions/<taskId>/ under it, identical to the rpc child's layout (spawn.ts).
    sessionDir: resolveChildSessionDir(spec.stateDir, spec.taskId),
    depth: spec.depth,
    parentSessionId: spec.parentSessionId,
    rootSessionId: spec.rootSessionId,
    prompt: spec.prompt,
    ...(context.agentDir !== undefined ? { agentDir: context.agentDir } : {}),
    ...(context.authStorage !== undefined ? { authStorage: context.authStorage } : {}),
    ...(context.modelRegistry !== undefined ? { modelRegistry: context.modelRegistry } : {}),
    ...(context.modelRuntime !== undefined ? { modelRuntime: context.modelRuntime } : {}),
    ...(context.model !== undefined ? { model: context.model } : {}),
    ...(context.thinkingLevel !== undefined ? { thinkingLevel: context.thinkingLevel } : {}),
    ...(spec.model !== undefined ? { selectedModel: spec.model } : {}),
    ...(spec.requestedModel !== undefined ? { requestedModel: spec.requestedModel } : {}),
    ...(spec.fallbackModels !== undefined ? { fallbackModels: spec.fallbackModels } : {}),
    ...(spec.resolvedModel !== undefined ? { resolvedModel: spec.resolvedModel } : {}),
    ...(spec.agentType !== undefined ? { agentType: spec.agentType } : {}),
    ...(spec.instructions !== undefined ? { instructions: spec.instructions } : {}),
    ...(spec.toolAllowlist !== undefined ? { toolAllowlist: spec.toolAllowlist } : {}),
    ...(spec.toolDenylist !== undefined ? { toolDenylist: spec.toolDenylist } : {}),
    ...(spec.memberScopedToolNames !== undefined ? { memberScopedToolNames: spec.memberScopedToolNames } : {}),
    ...(spec.memberScopedTools !== undefined ? { memberScopedTools: spec.memberScopedTools } : {}),
  }
}
