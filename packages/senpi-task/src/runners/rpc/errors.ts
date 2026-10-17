/** Typed error for a senpi RPC command that returned success:false. */
export class RpcCommandError extends Error {
  readonly command: string
  readonly detail: string

  constructor(command: string, detail: string) {
    super(`RPC command ${command} failed: ${detail}`)
    this.name = "RpcCommandError"
    this.command = command
    this.detail = detail
  }
}

/** The request may have reached the child; a timeout is not proof an input was refused. */
export class RpcRequestTimeout extends Error {
  constructor(readonly command: string, readonly deadlineMs: number) {
    super(`The child did not answer ${command} within ${deadlineMs} ms. Action: inspect task_output; do not resend an input until its delivery is resolved.`)
    this.name = "RpcRequestTimeout"
  }
}
