import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"

import { createEventState } from "./events"
import { waitForPromptStart } from "./prompt-start"
import type { RunContext, SessionStatus } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createMockContext(input: {
  statuses?: Record<string, SessionStatus>
  messages?: unknown[]
} = {}): RunContext {
  const statuses = input.statuses ?? {}
  const messages = input.messages ?? []

  return {
    client: unsafeTestValue<RunContext["client"]>({
      session: {
        status: mock(() => Promise.resolve({ data: statuses })),
        messages: mock(() => Promise.resolve({ data: messages })),
      },
    }),
    sessionID: "ses_run",
    directory: "/tmp/project",
    abortController: new AbortController(),
  }
}

let consoleErrorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe("waitForPromptStart", () => {
  it("#given the run session reaches busy status #when waiting for prompt start #then it resolves with start evidence", async () => {
    //#given
    const ctx = createMockContext({
      statuses: { ses_run: { type: "busy" } },
    })
    const eventState = createEventState()

    //#when
    await waitForPromptStart(ctx, eventState, ctx.abortController, {
      timeoutMs: 20,
      pollIntervalMs: 1,
    })

    //#then
    expect(eventState.mainSessionStarted).toBe(true)
    expect(eventState.mainSessionIdle).toBe(false)
  })

  it("#given messages are persisted before a busy status is observed #when waiting for prompt start #then it resolves", async () => {
    //#given
    const ctx = createMockContext({
      messages: [{ info: { id: "msg_user", role: "user" } }],
    })
    const eventState = createEventState()

    //#when
    await waitForPromptStart(ctx, eventState, ctx.abortController, {
      timeoutMs: 20,
      pollIntervalMs: 1,
    })

    //#then
    expect(eventState.mainSessionStarted).toBe(true)
  })

  it("#given no status or message start evidence arrives #when waiting for prompt start #then it fails instead of allowing silent success", async () => {
    //#given
    const ctx = createMockContext()
    const eventState = createEventState()

    //#when
    const result = waitForPromptStart(ctx, eventState, ctx.abortController, {
      timeoutMs: 5,
      pollIntervalMs: 1,
    })

    //#then
    await expect(result).rejects.toThrow("Prompt did not start within 5ms")
    expect(eventState.mainSessionStarted).toBe(false)
  })

  it("#given the session errors before starting #when waiting for prompt start #then it reports the session error", async () => {
    //#given
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionError = true
    eventState.lastError = "startup failed"

    //#when
    const result = waitForPromptStart(ctx, eventState, ctx.abortController, {
      timeoutMs: 20,
      pollIntervalMs: 1,
    })

    //#then
    await expect(result).rejects.toThrow("Session errored before prompt started: startup failed")
  })
})
