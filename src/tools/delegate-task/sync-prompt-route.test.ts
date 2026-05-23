import { describe, expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import type { OpencodeClient } from "./types"
import { sendSyncPrompt } from "./sync-prompt-sender"
import {
  promptSyncWithModelSuggestionRetry,
} from "../../shared/model-suggestion-retry"

type PromptSyncRetryClient = Parameters<typeof promptSyncWithModelSuggestionRetry>[0]
type PromptSyncRetryArgs = Parameters<typeof promptSyncWithModelSuggestionRetry>[1]

describe("sendSyncPrompt session routing", () => {
  test("#given a sync child session directory #when sending the prompt #then prompt uses that OpenCode directory route", async () => {
    // given
    const promptCalls: PromptSyncRetryArgs[] = []
    const promptSyncWithRetry = mock(async (_client: PromptSyncRetryClient, input: PromptSyncRetryArgs) => {
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
        promptSyncWithModelSuggestionRetry: promptSyncWithRetry,
      },
    )

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.query).toEqual({ directory: "/parent/project" })
  })

  test("#given oracle prompt returns unexpected EOF #when sending the prompt #then the sync route keeps the same directory route", async () => {
    // given
    const promptSyncCalls: PromptSyncRetryArgs[] = []
    const promptSyncWithRetry = mock(async (_client: PromptSyncRetryClient, input: PromptSyncRetryArgs) => {
      promptSyncCalls.push(input)
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
        promptSyncWithModelSuggestionRetry: promptSyncWithRetry,
      },
    )

    // then
    expect(result).toBeNull()
    expect(promptSyncCalls).toHaveLength(1)
    expect(promptSyncCalls[0]?.query).toEqual({ directory: "/parent/project" })
  })
})
