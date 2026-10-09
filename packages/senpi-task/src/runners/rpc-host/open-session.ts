import { asSenpiThinkingLevel } from "../../senpi/thinking-level"
import { splitModelDecorators } from "../../senpi/explicit-pin"
import type { HostSessionLiveness } from "./handle-port"
import {
  SESSION_START_FAILURE_REASONS,
  isTaskStartFailureReason,
  type TaskStartFailureReason,
} from "../../state"
import { RunnerError } from "../in-process/runner-error"
import type { RpcRunnerSpec } from "../types"
import { HostUnavailableError } from "./daemon"
import {
  HostSessionOpenError,
  SessionHeldElsewhereError,
  type OpenedHostSession,
} from "./session-client"
import { buildChildContext } from "./session-context"
import { childRetryFallbackProfile } from "../retry-fallback-profile"
import type { HostRetryFallbackProfile, HostSessionOpenInput } from "./session-transport"

const SESSION_FAILURE_REASONS = new Set<TaskStartFailureReason>(SESSION_START_FAILURE_REASONS)

export async function openTaskHostSession(input: {
  readonly client: {
    open(request: HostSessionOpenInput): Promise<OpenedHostSession>
    getState?(): Promise<HostSessionLiveness>
    close?(): Promise<void>
  }
  readonly spec: RpcRunnerSpec
  readonly sessionPath: string
}): Promise<OpenedHostSession> {
  const model = splitModelRef(input.spec.model)
  const thinkingLevel = asSenpiThinkingLevel(input.spec.reasoning ?? input.spec.variant) ?? asSenpiThinkingLevel(model?.thinkingLevel)
  let opened: OpenedHostSession
  try {
    opened = await input.client.open({
      sessionPath: input.sessionPath,
      cwd: input.spec.cwd,
      ...(model === undefined ? {} : { provider: model.provider, modelId: model.modelId }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      ...buildChildContext(input.spec),
      retainOnDisconnect: true,
      autoTitle: false,
      ...childRetryFallback(input.spec),
    })
  } catch (error) {
    if (error instanceof HostUnavailableError) throw error
    const reason = sessionFailureReason(error)
    throw new RunnerError({
      kind: "session_unavailable",
      message: error instanceof Error ? error.message : String(error),
      ...(reason === undefined ? {} : { reason }),
      cause: error,
    })
  }
  // Post-start check (#9722): a FRESH open (attached !== true) must have opened on the requested
  // base id. The host answers get_state with its effective model; a mismatch, an unreadable
  // state, or a state carrying NO model all fail typed - a check that silently skips on error is
  // no check at all. An ATTACHED open re-joins a session that is already running its own model -
  // recovery re-opens must not re-assert the pin against it, and this read is skipped entirely so
  // a held or model-less get_state can never break a reattach. The open succeeded, so this
  // channel is closed here - the caller never sees a handle.
  const freshOpen = opened.attached !== true
  if (model !== undefined && freshOpen) {
    let effective: HostSessionLiveness["model"]
    try {
      effective = (await input.client.getState?.())?.model
    } catch (error) {
      await input.client.close?.().catch(() => undefined)
      throw new RunnerError({
        kind: "model_unavailable",
        message: `the host's effective model could not be read after opening the requested ${model.provider}/${model.modelId}; refusing to start unverified`,
        cause: error,
      })
    }
    if (effective === undefined) {
      await input.client.close?.().catch(() => undefined)
      throw new RunnerError({
        kind: "model_unavailable",
        message: `the host reported no model after opening the requested ${model.provider}/${model.modelId}; refusing to start unverified`,
      })
    }
    if (effective.provider !== model.provider || effective.id !== model.modelId) {
      await input.client.close?.().catch(() => undefined)
      throw new RunnerError({
        kind: "model_unavailable",
        message: `the host opened the child on ${effective.provider}/${effective.id} instead of the requested ${model.provider}/${model.modelId}; refusing the substitution`,
      })
    }
    return { ...opened, reportedModel: effective }
  }
  if (freshOpen && input.client.getState !== undefined) {
    const state = await input.client.getState().catch(() => undefined)
    const effective = state?.model
    return effective === undefined ? opened : { ...opened, reportedModel: effective }
  }
  return opened
}

function sessionFailureReason(error: unknown): TaskStartFailureReason | undefined {
  if (error instanceof SessionHeldElsewhereError) return "session_path_in_use"
  if (
    error instanceof HostSessionOpenError &&
    isTaskStartFailureReason(error.code) &&
    SESSION_FAILURE_REASONS.has(error.code)
  ) {
    return error.code
  }
  if (error instanceof Error && error.message.startsWith("Timeout waiting for response to open_session.")) {
    return "open_timed_out"
  }
  return undefined
}

/** A child without a chain sends no profile, so the host keeps applying its own settings' fallback. */
function childRetryFallback(spec: RpcRunnerSpec): { readonly retryFallback?: HostRetryFallbackProfile } {
  const retryFallback = childRetryFallbackProfile(spec)
  return retryFallback === undefined ? {} : { retryFallback }
}

/**
 * Split a task model reference into the wire's provider/modelId pair, first stripping any
 * `:<thinking-level>`/`:<service-tier>` decorators with the same grammar senpi's `--model` parses
 * (#9722): the suffix rides `thinkingLevel` instead of being sent as part of the id. A reference
 * with no usable provider/model boundary yields undefined, so the host keeps its own resolution.
 */
function splitModelRef(model: string | undefined): { readonly provider: string; readonly modelId: string; readonly thinkingLevel?: string } | undefined {
  if (model === undefined) return undefined
  const { base, thinkingLevel } = splitModelDecorators(model)
  const separator = base.indexOf("/")
  if (separator <= 0 || separator === base.length - 1) return undefined
  return {
    provider: base.slice(0, separator),
    modelId: base.slice(separator + 1),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  }
}
