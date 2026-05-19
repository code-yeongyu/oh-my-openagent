import { afterEach, describe, expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting } from "./prompt-async-gate"
import { promptAsyncInDirectory, promptWithRetryInDirectory } from "./session-route"

describe("promptAsyncInDirectory", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given no session id is present #when routing a promptAsync request #then the helper rejects instead of using an ungated raw prompt", async () => {
    // given
    const promptAsync = mock(async () => ({ data: "sent" }))
    const client = {
      session: {
        promptAsync,
      },
    }
    const args = {
      body: { parts: [{ type: "text", text: "continue" }] },
    }

    // when, then
    await expect(
      promptAsyncInDirectory(
        unsafeTestValue(client),
        unsafeTestValue(args),
        "/workspace/project",
      ),
    ).rejects.toThrow("session id is required for routed promptAsync")
    expect(promptAsync).toHaveBeenCalledTimes(0)
  })

  test("#given a routed prompt just dispatched #when the same session is prompted again immediately #then the route defers the duplicate", async () => {
    // given
    const promptAsync = mock(async () => ({ data: "sent" }))
    const client = {
      session: {
        promptAsync,
      },
    }
    const args = {
      path: { id: "ses_route_hold" },
      body: { parts: [{ type: "text", text: "continue" }] },
    }

    // when
    const first = await promptAsyncInDirectory(
      unsafeTestValue(client),
      unsafeTestValue(args),
      "/workspace/project",
    )
    const second = promptAsyncInDirectory(
      unsafeTestValue(client),
      unsafeTestValue(args),
      "/workspace/project",
    )

    // then
    expect(first).toEqual({ data: "sent" })
    await expect(second).rejects.toThrow("promptAsync skipped by gate: reserved")
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(promptAsync.mock.calls[0]?.[0].query).toEqual({ directory: "/workspace/project" })
  })
})

describe("promptWithRetryInDirectory", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a routed retry prompt just dispatched #when the same session is prompted again immediately #then the wrapper defers instead of enqueueing", async () => {
    // given
    const promptAsync = mock(async () => undefined)
    const client = {
      session: {
        promptAsync,
      },
    }
    const args = {
      path: { id: "ses_retry_route_hold" },
      body: { parts: [{ type: "text", text: "continue" }] },
    }

    // when
    await promptWithRetryInDirectory(
      unsafeTestValue(client),
      unsafeTestValue(args),
      "/workspace/project",
    )
    const second = promptWithRetryInDirectory(
      unsafeTestValue(client),
      unsafeTestValue(args),
      "/workspace/project",
    )

    // then
    await expect(second).rejects.toThrow("promptAsync skipped by gate: reserved")
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(promptAsync.mock.calls[0]?.[0].query).toEqual({ directory: "/workspace/project" })
  })
})
