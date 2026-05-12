import { describe, expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import type { OpencodeClient } from "./types"
import { sendSyncPrompt } from "./sync-prompt-sender"
import {
  promptSyncWithModelSuggestionRetry,
  promptWithModelSuggestionRetry,
} from "../../shared/model-suggestion-retry"

type PromptRetryClient = Parameters<typeof promptWithModelSuggestionRetry>[0]
type PromptRetryArgs = Parameters<typeof promptWithModelSuggestionRetry>[1]
type PromptSyncRetryClient = Parameters<typeof promptSyncWithModelSuggestionRetry>[0]
type PromptSyncRetryArgs = Parameters<typeof promptSyncWithModelSuggestionRetry>[1]

describe("sendSyncPrompt session routing", () => {
  test("#given a sync child session directory #when sending the prompt #then promptAsync uses that OpenCode directory route", async () => {
    // given
    const promptCalls: PromptRetryArgs[] = []
    const promptWithRetry = mock(async (_client: PromptRetryClient, input: PromptRetryArgs) => {
      promptCalls.push(input)
    })

    // when
    await sendSyncPrompt(
      unsafeTestValue<OpencodeClient>({ session: {} }),
      {
        sessionID: "ses_child",
        agentToUse: "sisyphus-junior",
        args: {
          description: "test task",
          prompt: "test prompt",
          run_in_background: false,
          load_skills: [],
        },
        systemContent: undefined,
        categoryModel: undefined,
        directory: "/parent/project",
        toastManager: null,
        taskId: undefined,
      },
      {
        promptWithModelSuggestionRetry: promptWithRetry,
        promptSyncWithModelSuggestionRetry: mock(async () => {}),
      },
    )

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent/project" })
  })

  test("#given oracle falls back to promptSync #when async prompt returns unexpected EOF #then the sync retry keeps the same directory route", async () => {
    // given
    const promptSyncCalls: PromptSyncRetryArgs[] = []
    const promptWithRetry = mock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const promptSyncWithRetry = mock(async (_client: PromptSyncRetryClient, input: PromptSyncRetryArgs) => {
      promptSyncCalls.push(input)
    })

    // when
    const result = await sendSyncPrompt(
      unsafeTestValue<OpencodeClient>({ session: {} }),
      {
        sessionID: "ses_child",
        agentToUse: "oracle",
        args: {
          description: "test task",
          prompt: "test prompt",
          run_in_background: false,
          load_skills: [],
        },
        systemContent: undefined,
        categoryModel: undefined,
        directory: "/parent/project",
        toastManager: null,
        taskId: undefined,
      },
      {
        promptWithModelSuggestionRetry: promptWithRetry,
        promptSyncWithModelSuggestionRetry: promptSyncWithRetry,
      },
    )

    // then
    expect(result).toBeNull()
    expect(promptSyncCalls).toHaveLength(1)
    expect(promptSyncCalls[0]?.query).toEqual({ directory: "/parent/project" })
  })
})
