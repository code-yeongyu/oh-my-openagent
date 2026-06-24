/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

type CompatPromptInput = {
  readonly path: { readonly id: string } | string
  readonly body: {
    readonly parts: readonly []
  }
}

function createPathSensitivePrompt() {
  const calls: CompatPromptInput[] = []
  const prompt = mock(async (input: CompatPromptInput) => {
    calls.push(input)
    if (typeof input.path !== "string") {
      throw new TypeError('The "path" property must be of type string, got object')
    }
    return { ok: true }
  })

  return { calls, prompt }
}

describe("dispatchInternalPrompt path compatibility", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given sync prompt rejects object-form session path #when dispatching #then it retries with string-form path", async () => {
    // given
    const { calls, prompt } = createPathSensitivePrompt()
    const client = { session: { prompt } }

    // when
    const result = await dispatchInternalPrompt<CompatPromptInput>({
      mode: "sync",
      client,
      sessionID: "ses_sync_path_compat",
      source: "test:path-compat:sync",
      settleMs: 0,
      checkStatus: false,
      checkToolState: false,
      queueBehavior: "defer",
      input: {
        path: { id: "ses_sync_path_compat" },
        body: { parts: [] },
      },
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(calls.map((call) => call.path)).toEqual([
      { id: "ses_sync_path_compat" },
      "ses_sync_path_compat",
    ])
  })

  test("#given async prompt rejects object-form session path #when dispatching #then it retries with string-form path", async () => {
    // given
    const { calls, prompt } = createPathSensitivePrompt()
    const client = { session: { promptAsync: prompt } }

    // when
    const result = await dispatchInternalPrompt<CompatPromptInput>({
      mode: "async",
      client,
      sessionID: "ses_async_path_compat",
      source: "test:path-compat:async",
      settleMs: 0,
      checkStatus: false,
      checkToolState: false,
      queueBehavior: "defer",
      input: {
        path: { id: "ses_async_path_compat" },
        body: { parts: [] },
      },
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(calls.map((call) => call.path)).toEqual([
      { id: "ses_async_path_compat" },
      "ses_async_path_compat",
    ])
  })
})
