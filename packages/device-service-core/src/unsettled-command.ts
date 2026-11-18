import { LocalApiError } from "./local-api/errors.ts"
import type { CommandStateEvent } from "./local-api/protocol.ts"

// omo#14130: past this state the command left this device: the relay holds it for the target (transport_confirmed) or the
// target's host dispatched it (engine_dispatched). Its final state may still be lost on the way back, so a caller can
// tell "delivered, reply lost" from "never left" and must not resend the first blindly.
const DELIVERED: ReadonlySet<CommandStateEvent["state"]> = new Set(["transport_confirmed", "engine_dispatched"])

/** A command whose final state did not arrive within its wait: request_timeout, its command_id and last progress kept. */
export class UnsettledCommandError extends LocalApiError {
  readonly progress: CommandStateEvent["state"] | undefined
  readonly delivered: boolean

  constructor(commandId: string, waitMs: number, progress: CommandStateEvent["state"] | undefined) {
    const last = progress === undefined ? "" : ` (last state ${progress})`
    super("request_timeout", `no final state for command ${commandId} within ${waitMs} ms${last}`, {
      command_id: commandId,
    })
    this.name = "UnsettledCommandError"
    this.progress = progress
    this.delivered = progress !== undefined && DELIVERED.has(progress)
  }
}
