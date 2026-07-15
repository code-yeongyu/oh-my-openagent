/// <reference types="bun-types" />

import { afterEach, expect, test } from "bun:test"

import type { PluginInput } from "@opencode-ai/plugin"

import { QUESTION_DENIED_SESSION_PERMISSION } from "../../shared/question-denied-session-permission"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type ResumePromptInput = {
  readonly query?: { readonly directory?: string }
  readonly body?: {
    readonly agent?: string
    readonly model?: { readonly providerID?: string; readonly modelID?: string }
    readonly variant?: string
    readonly tools?: Readonly<Record<string, boolean>>
  }
}

function cast<TValue>(value: unknown): TValue {
  return value as TValue
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return cast<{ tasks: Map<string, BackgroundTask> }>(manager).tasks
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

test("resumes an exact project agent from its saved worktree directory", async () => {
  // given
  const promptCalls: ResumePromptInput[] = []
  const parentDirectory = "/repository"
  const memberDirectory = "/repository/worktrees/reviewer"
  const client = {
    session: {
      abort: async () => ({}),
      promptAsync: async (input: ResumePromptInput) => {
        promptCalls.push(input)
        return {}
      },
    },
  }
  const manager = new BackgroundManager({
    pluginContext: cast<PluginInput>({ client, directory: parentDirectory }),
  })
  const task: BackgroundTask = {
    id: "bg_project_resume",
    sessionId: "ses_project_resume",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    teamRunId: "team-run",
    description: "resume project reviewer",
    prompt: "review repository",
    agent: "repository-reviewer",
    directory: memberDirectory,
    exactAgent: true,
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    model: { providerID: "openai", modelID: "gpt-5.6-sol", variant: "xhigh" },
    sessionPermission: QUESTION_DENIED_SESSION_PERMISSION,
    concurrencyGroup: "openai/gpt-5.6-sol",
  }
  getTaskMap(manager).set(task.id, task)

  try {
    // when
    await manager.resume({
      sessionId: task.sessionId ?? "",
      prompt: "continue review",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message-2",
    })
    for (let attempt = 0; attempt < 12 && promptCalls.length === 0; attempt += 1) {
      await Promise.resolve()
    }

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]).toMatchObject({
      query: { directory: memberDirectory },
      body: {
        agent: "repository-reviewer",
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
        variant: "xhigh",
      },
    })
    expect(promptCalls[0]?.body?.tools).toBeUndefined()
    expect(task.exactAgent).toBe(true)
    expect(task.sessionPermission).toEqual(QUESTION_DENIED_SESSION_PERMISSION)
  } finally {
    await manager.shutdown()
  }
})
