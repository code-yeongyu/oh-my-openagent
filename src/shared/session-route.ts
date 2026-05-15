import type { PluginInput } from "@opencode-ai/plugin"
import {
  promptSyncWithModelSuggestionRetry,
  promptWithModelSuggestionRetry,
} from "./model-suggestion-retry"
import { promptAsyncAfterSessionIdle } from "./prompt-async-gate"

type OpencodeClient = PluginInput["client"]

type PromptAsyncArgs = Parameters<OpencodeClient["session"]["promptAsync"]>[0]
type SessionMessagesArgs = Parameters<OpencodeClient["session"]["messages"]>[0]
type PromptRetryClient = Parameters<typeof promptWithModelSuggestionRetry>[0]
type PromptRetryArgs = Parameters<typeof promptWithModelSuggestionRetry>[1]
type PromptSyncRetryClient = Parameters<typeof promptSyncWithModelSuggestionRetry>[0]
type PromptSyncRetryArgs = Parameters<typeof promptSyncWithModelSuggestionRetry>[1]

export function routeSessionPrompt(args: PromptAsyncArgs, directory: string): PromptAsyncArgs {
  return {
    ...args,
    query: { directory },
  }
}

export function routePromptRetry(args: PromptRetryArgs, directory: string): PromptRetryArgs {
  return {
    ...args,
    query: { directory },
  }
}

export function routePromptSyncRetry(
  args: PromptSyncRetryArgs,
  directory: string,
): PromptSyncRetryArgs {
  return {
    ...args,
    query: { directory },
  }
}

export function routeSessionMessages(
  args: SessionMessagesArgs,
  directory: string,
): SessionMessagesArgs {
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

  return promptAsyncAfterSessionIdle({
    client,
    sessionID,
    input: routedArgs,
    source: "session-route",
    settleMs: 0,
  }).then((result) => {
    if (result.status === "failed") {
      throw result.error
    }
    if (result.status !== "dispatched") {
      throw new Error(`promptAsync skipped by gate: ${result.status}`)
    }
    return result.response
  })
}

export function promptWithRetryInDirectory(
  client: PromptRetryClient,
  args: PromptRetryArgs,
  directory: string,
): Promise<void> {
  return promptWithModelSuggestionRetry(client, routePromptRetry(args, directory))
}

export function promptSyncWithRetryInDirectory(
  client: PromptSyncRetryClient,
  args: PromptSyncRetryArgs,
  directory: string,
): Promise<void> {
  return promptSyncWithModelSuggestionRetry(client, routePromptSyncRetry(args, directory))
}

export function messagesInDirectory(
  client: OpencodeClient,
  args: SessionMessagesArgs,
  directory: string,
): Promise<unknown> {
  return client.session.messages(routeSessionMessages(args, directory))
}
