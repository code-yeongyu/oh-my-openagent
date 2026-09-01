import { describe, expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OpencodeClient } from "./types"
import { sendSyncPrompt } from "./sync-prompt-sender"
import {
  promptWithModelSuggestionRetry,
} from "../../shared/model-suggestion-retry"

type PromptRetryClient = Parameters<typeof promptWithModelSuggestionRetry>[0]
type PromptRetryArgs = Parameters<typeof promptWithModelSuggestionRetry>[1]

describe("sendSyncPrompt session routing", () => {
  test("#given a sync child session directory #when sending the prompt #then prompt uses that OpenCode directory route", async () => {
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
      },
    )

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent/project" })
  })

  test("#given oracle prompt returns unexpected EOF #when sending the prompt #then the sync route keeps the same directory route", async () => {
    // given
    const promptCalls: PromptRetryArgs[] = []
    const promptWithRetry = mock(async (_client: PromptRetryClient, input: PromptRetryArgs) => {
      promptCalls.push(input)
      throw new Error("JSON Parse error: Unexpected EOF")
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
      },
    )

    // then
    expect(result).toBeNull()
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent/project" })
  })
})
