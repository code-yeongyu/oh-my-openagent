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
