import type { HostSessionCommand } from "./session-client-contract"
import type { HostPromptDisposition, HostQueuedInputDisposition, HostRpcClient } from "./session-transport"

// The runner does not consume the host's input disposition, so a delivered command settles with no value.
const ignoreHostDisposition = (_disposition: HostPromptDisposition | HostQueuedInputDisposition): void => undefined

/** Issue one child command on the engine client that holds the child's session. */
export function dispatchHostCommand(client: HostRpcClient, routingId: string | undefined, command: HostSessionCommand): Promise<void> {
  switch (command.type) {
    case "prompt":
      return client.prompt(
        command.message,
        { ...(command.streamingBehavior === undefined ? {} : { streamingBehavior: command.streamingBehavior }),
          ...(command.clientMessageId === undefined ? {} : { clientMessageId: command.clientMessageId }) },
      ).then(ignoreHostDisposition)
    case "steer":
      return client.steer(command.message, undefined, { clientMessageId: command.clientMessageId }).then(ignoreHostDisposition)
    case "followUp":
      return client.followUp(command.message, undefined, { clientMessageId: command.clientMessageId }).then(ignoreHostDisposition)
    case "abort":
      return client.abort()
    case "set_session_context":
      return client.setSessionContext(command.patch, routingId)
    default:
      return unhandledCommand(command)
  }
}

function unhandledCommand(command: never): never {
  throw new Error(`unhandled host session command: ${JSON.stringify(command)}`)
}
