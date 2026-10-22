import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import type { BackgroundTaskConfig } from "../../config/schema"

export type FixtureMessage = { info?: { id?: string; role?: string; time?: { completed: number } }; parts?: Array<{ type?: string; text?: string }> }

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

export function previousRunMessages(): FixtureMessage[] {
  return [
    { info: { id: "msg_launch", role: "user" }, parts: [{ type: "text", text: "launch prompt" }] },
    { info: { id: "msg_prev_answer", role: "assistant", time: { completed: 1 } }, parts: [{ type: "text", text: "previous run answer" }] },
  ]
}

export function createManagerWithMessages(messages: FixtureMessage[], options?: { appendOnPrompt?: boolean; config?: BackgroundTaskConfig }) {
  const aborts: string[] = []
  const prompts: string[][] = []
  const submitted = Promise.withResolvers<void>()
  const client = {
    session: {
      status: async (_request?: { query?: { directory?: string } }): Promise<unknown> => ({ data: { ses_bg_anchor: { type: "idle" } } }),
      get: async () => ({ data: { id: "ses_bg_anchor" } }),
      prompt: async () => ({}),
      promptAsync: async (request: { body: { parts: Array<{ text?: string }> } }) => {
        prompts.push(request.body.parts.map((part) => part.text ?? ""))
        submitted.resolve()
        if (options?.appendOnPrompt) {
          messages.push({ info: { id: `msg_continue_user_${messages.length}`, role: "user" }, parts: [{ type: "text", text: "continuation prompt" }] })
        }
        return { data: {} }
      },
      abort: async () => { aborts.push("aborted"); return { data: true } },
      todo: async () => ({ data: [] }),
      messages: async (_request?: { query?: { directory?: string } }): Promise<unknown> => ({ data: messages }),
    },
  }
  const manager = new BackgroundManager({ pluginContext: createPluginContext(client), config: options?.config, enableParentSessionNotifications: false })
  return { manager, prompts, aborts, client, submitted: submitted.promise }
}

export function createCompletedTask(): BackgroundTask {
  return {
    id: "bg_anchor", status: "completed", sessionId: "ses_bg_anchor", parentSessionId: "ses_parent",
    parentMessageId: "msg_parent", description: "synthetic task", prompt: "launch prompt", agent: "explore",
    concurrencyGroup: "explore", completedAt: new Date(), startedAt: new Date(Date.now() - 60_000),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

export const resumeInput = { sessionId: "ses_bg_anchor", prompt: "continue", parentSessionId: "ses_parent", parentMessageId: "msg_parent" }
