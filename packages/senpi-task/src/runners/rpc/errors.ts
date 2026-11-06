/** The shape an engine error code must have to leave the wire boundary; anything else may be free text. */
export const ERROR_CODE_SHAPE = /^[a-z][a-z0-9_]{0,47}$/
/** The shape a provider id must have to leave the wire boundary. */
export const PROVIDER_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** The typed fields of a refused response; anything off-shape is dropped here, at the wire boundary. */
export type RpcRefusalFields = { readonly errorCode?: unknown; readonly errorData?: unknown }

/** Typed error for a senpi RPC command that returned success:false. */
export class RpcCommandError extends Error {
  readonly command: string
  readonly detail: string
  readonly errorCode?: string
  /** Only the validated provider of the engine's errorData; the rest of the payload is never kept. */
  readonly errorData?: { readonly provider: string }

  constructor(command: string, detail: string, refusal: RpcRefusalFields = {}) {
    super(`RPC command ${command} failed: ${detail}`)
    this.name = "RpcCommandError"
    this.command = command
    this.detail = detail
    if (typeof refusal.errorCode === "string" && ERROR_CODE_SHAPE.test(refusal.errorCode)) this.errorCode = refusal.errorCode
    const data = refusal.errorData
    const provider = typeof data === "object" && data !== null && "provider" in data ? data.provider : undefined
    if (typeof provider === "string" && PROVIDER_SHAPE.test(provider)) this.errorData = { provider }
  }
}

/** The request may have reached the child; a timeout is not proof an input was refused. */
export class RpcRequestTimeout extends Error {
  constructor(readonly command: string, readonly deadlineMs: number) {
    super(`The child did not answer ${command} within ${deadlineMs} ms. Action: inspect task_output; do not resend an input until its delivery is resolved.`)
    this.name = "RpcRequestTimeout"
  }
}
