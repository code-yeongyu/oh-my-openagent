import type { PluginInput } from "@opencode-ai/plugin"

import { promptWithModelSuggestionRetry } from "../../shared"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../shared/prompt-async-gate"

type OpencodeClient = PluginInput["client"]

type PromptAsyncArgs = Parameters<OpencodeClient["session"]["promptAsync"]>[0]
type PromptRetryClient = Parameters<typeof promptWithModelSuggestionRetry>[0]
type PromptRetryArgs = Parameters<typeof promptWithModelSuggestionRetry>[1]
type SessionMessagesArgs = Parameters<OpencodeClient["session"]["messages"]>[0]

export function routeSessionPrompt(args: PromptAsyncArgs, directory: string): PromptAsyncArgs {
  return {
    ...args,
    query: { directory },
  }
}

function routePromptRetry(args: PromptRetryArgs, directory: string): PromptRetryArgs {
  return {
    ...args,
    query: { directory },
  }
}

export function promptAsyncInDirectory(
  client: OpencodeClient,
  args: PromptAsyncArgs,
  directory: string,
): Promise<unknown> {
  const routedArgs = routeSessionPrompt(args, directory)
  const sessionID = routedArgs.path?.id
  if (!sessionID) {
    return Promise.reject(new Error("session id is required for routed promptAsync"))
  }

  return dispatchInternalPrompt({
    mode: "async",
    client,
    sessionID,
    input: routedArgs,
    source: "background-agent-session-route",
    settleMs: 0,
    queueBehavior: "defer",
  }).then((result) => {
    if (result.status === "failed") {
      throw result.error
    }
    if (!isInternalPromptDispatchAccepted(result)) {
      throw new Error(`promptAsync skipped by gate: ${result.status}`)
    }
    return result.status === "dispatched" ? result.response : undefined
  })
}

export function promptWithRetryInDirectory(
  client: PromptRetryClient,
  args: PromptRetryArgs,
  directory: string,
): Promise<void> {
  return promptWithModelSuggestionRetry(client, routePromptRetry(args, directory), { queueBehavior: "defer" })
}

export function messagesInDirectory(
  client: OpencodeClient,
  args: SessionMessagesArgs,
  directory: string,
): Promise<unknown> {
  return client.session.messages({
    ...args,
    query: { directory },
  })
}
