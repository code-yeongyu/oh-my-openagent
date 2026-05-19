import { afterEach, describe, expect, mock, test } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { promptAsyncInDirectory, promptWithRetryInDirectory } from "./session-route"

describe("background-agent session routing", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a routed prompt just dispatched #when the same child session is prompted again immediately #then promptAsync routing defers instead of enqueueing", async () => {
    // given
    const promptAsync = mock(async () => ({ data: "sent" }))
    const client = {
      session: {
        promptAsync,
      },
    }
    const args = {
      path: { id: "ses_background_route_hold" },
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

  test("#given a background retry prompt just dispatched #when the same child session is prompted again immediately #then retry routing defers instead of enqueueing", async () => {
    // given
    const promptAsync = mock(async () => undefined)
    const client = {
      session: {
        promptAsync,
      },
    }
    const args = {
      path: { id: "ses_background_retry_route_hold" },
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
