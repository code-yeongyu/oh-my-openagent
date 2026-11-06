/**
 * Classifies WHY a child's first prompt (or its session reopen) was rejected, from the error the
 * runner caught. The caught message is untrusted child/host output (it embeds a stderr tail), so it
 * is never copied anywhere: only a closed class, an allow-listed command name and a shape-checked
 * host error code leave this module.
 */
import { RPC_RESPONSE_TIMEOUT_PREFIX as TIMEOUT_PREFIX } from "../runners/rpc-host/reattach"
import { ERROR_CODE_SHAPE, PROVIDER_SHAPE } from "../runners/rpc/errors"

export type StartCauseClass = "request_timeout" | "host_refused" | "transport_lost" | "credentials_missing"

export type StartCause = {
  readonly cause_class: StartCauseClass
  readonly timed_out_command?: string
  readonly cause_code?: string
  readonly provider?: string
}

const TIMED_OUT_COMMANDS = new Set(["prompt", "switch_session", "open_session", "get_entries", "steer", "follow_up"])
const TRANSPORT_LOSS_CODES = new Set(["rpc_transport_gone", "session_detached", "transport_recovery_expired"])
// The engine's typed "this provider cannot authenticate" refusals. An expired login that could not be
// refreshed is as provider-wide as a missing key, so both walk the chain the same way.
const CREDENTIAL_CODES = new Set(["provider_credentials_missing", "provider_credentials_expired"])

export function classifyStartCause(cause: unknown): StartCause | undefined {
  try {
    if (!(cause instanceof Error)) return undefined
    const code = (cause as { readonly code?: unknown }).code
    if (typeof code === "string" && TRANSPORT_LOSS_CODES.has(code)) return { cause_class: "transport_lost" }
    if (cause.name === "RpcCommandError") {
      const refusal = cause as { readonly errorCode?: unknown; readonly errorData?: unknown }
      return hostRefusal(refusal.errorCode, refusal.errorData)
    }
    if (cause.message.startsWith(TIMEOUT_PREFIX)) return requestTimeout(cause.message.slice(TIMEOUT_PREFIX.length))
    return undefined
  } catch {
    return undefined
  }
}

function hostRefusal(errorCode: unknown, errorData: unknown): StartCause {
  if (typeof errorCode === "string" && CREDENTIAL_CODES.has(errorCode)) {
    const provider = typeof errorData === "object" && errorData !== null && "provider" in errorData ? errorData.provider : undefined
    return {
      cause_class: "credentials_missing",
      cause_code: errorCode,
      ...(typeof provider === "string" && PROVIDER_SHAPE.test(provider) ? { provider } : {}),
    }
  }
  return typeof errorCode === "string" && ERROR_CODE_SHAPE.test(errorCode)
    ? { cause_class: "host_refused", cause_code: errorCode }
    : { cause_class: "host_refused" }
}

function requestTimeout(rest: string): StartCause {
  const command = /^([a-z_]+)\./.exec(rest)?.[1]
  return command !== undefined && TIMED_OUT_COMMANDS.has(command)
    ? { cause_class: "request_timeout", timed_out_command: command }
    : { cause_class: "request_timeout" }
}

export function describeStartCause(cause: StartCause, operation: "prompt" | "session"): string {
  switch (cause.cause_class) {
    case "request_timeout": {
      const command = cause.timed_out_command ?? (operation === "prompt" ? "prompt" : "session")
      return operation === "prompt"
        ? `no answer to the ${command} request in time (request_timeout)`
        : `no answer to the ${command} request in time (request_timeout)`
    }
    case "host_refused": {
      const code = cause.cause_code === undefined ? "host_refused" : `host_refused: ${cause.cause_code}`
      return operation === "prompt" ? `the prompt was refused (${code})` : `the session open was refused (${code})`
    }
    case "transport_lost":
      return "the connection to the child was lost (transport_lost)"
    case "credentials_missing": {
      const provider = cause.provider ?? "its provider"
      return `${provider} has no usable credentials (${cause.cause_code ?? "credentials_missing"}); sign in to ${provider} or add its API key`
    }
    default:
      return assertNever(cause.cause_class)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected start cause class: ${JSON.stringify(value)}`)
}
