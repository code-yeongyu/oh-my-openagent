import { describe, expect, test } from "bun:test"

import { isActiveSessionStatusType, isSessionActive, shouldPromptAfterSessionIdle } from "./session-idle-settle"

describe("isActiveSessionStatusType", () => {
  test("#given known active status types #when checking activity #then returns true", () => {
    expect(isActiveSessionStatusType("busy")).toBe(true)
    expect(isActiveSessionStatusType("retry")).toBe(true)
    expect(isActiveSessionStatusType("running")).toBe(true)
  })

  test("#given inactive or unknown status types #when checking activity #then returns false", () => {
    expect(isActiveSessionStatusType("idle")).toBe(false)
    expect(isActiveSessionStatusType("error")).toBe(false)
  })
})

describe("isSessionActive", () => {
  test("#given client without status method #when checking session activity #then returns false", async () => {
    expect(await isSessionActive({}, "ses_1")).toBe(false)
  })

  test("#given direct status payload #when session is busy #then returns true", async () => {
    const client = {
      session: {
        status: async () => ({ ses_1: { type: "busy" } }),
      },
    }

    expect(await isSessionActive(client, "ses_1")).toBe(true)
  })

  test("#given nested data payload #when session is running #then returns true", async () => {
    const client = {
      session: {
        status: async () => ({ data: { ses_1: { type: "running" } } }),
      },
    }

    expect(await isSessionActive(client, "ses_1")).toBe(true)
  })

  test("#given missing or inactive status #when checking session activity #then returns false", async () => {
    const client = {
      session: {
        status: async () => ({ data: { ses_1: { type: "idle" } } }),
      },
    }

    expect(await isSessionActive(client, "ses_1")).toBe(false)
    expect(await isSessionActive(client, "ses_missing")).toBe(false)
  })

  test("#given status lookup rejection #when checking session activity #then returns false", async () => {
    const client = {
      session: {
        status: async () => {
          throw new Error("status unavailable")
        },
      },
    }

    expect(await isSessionActive(client, "ses_1")).toBe(false)
  })
})

describe("shouldPromptAfterSessionIdle", () => {
  test("#given idle session after settle #when checking prompt permission #then returns true", async () => {
    const client = {
      session: {
        status: async () => ({ data: { ses_1: { type: "idle" } } }),
      },
    }

    expect(await shouldPromptAfterSessionIdle(client, "ses_1", 0)).toBe(true)
  })

  test("#given active session after settle #when checking prompt permission #then returns false", async () => {
    const client = {
      session: {
        status: async () => ({ data: { ses_1: { type: "retry" } } }),
      },
    }

    expect(await shouldPromptAfterSessionIdle(client, "ses_1", 0)).toBe(false)
  })
})
