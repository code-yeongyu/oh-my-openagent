import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { getSessionActivityFromClient } from "./session-activity"
import { checkSessionExistence } from "./session-existence"
import type { OpencodeClient } from "./opencode-client"

function clientThatRejects(error: unknown): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
    session: {
      abort: mock(() => Promise.resolve()),
      get: mock(() => Promise.reject(error)),
    },
  })
}

function clientThatReturnsError(error: unknown): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
    session: {
      abort: mock(() => Promise.resolve()),
      get: mock(() => Promise.resolve({ error })),
    },
  })
}

const UNREACHABLE = new Error("Unable to connect. Is the computer able to access the url?")

describe("session reads against an unreachable server", () => {
  test("#given the server cannot be reached #when checking existence #then the session is not reported as live", async () => {
    expect(await checkSessionExistence(clientThatRejects(UNREACHABLE), "ses-1")).toBe("missing")
  })

  test("#given the server cannot be reached #when reading activity #then no activity is reported", async () => {
    const lookup = await getSessionActivityFromClient(clientThatRejects(UNREACHABLE), "ses-1")
    expect(lookup.type).toBe("missing")
  })

  test("#given a rejected connection reported in the response #when checking existence #then it is treated the same as a thrown one", async () => {
    const connectionRefused = { message: "connect ECONNREFUSED 127.0.0.1:4096" }
    expect(await checkSessionExistence(clientThatReturnsError(connectionRefused), "ses-1")).toBe("missing")
  })

  test("#given a real server error #when checking existence #then the answer stays unknown", async () => {
    const serverError = { status: 500, message: "internal server error" }
    expect(await checkSessionExistence(clientThatReturnsError(serverError), "ses-1")).toBe("unknown")
  })

  test("#given a real server error #when reading activity #then the answer stays unavailable", async () => {
    const serverError = { status: 500, message: "internal server error" }
    const lookup = await getSessionActivityFromClient(clientThatReturnsError(serverError), "ses-1")
    expect(lookup.type).toBe("unavailable")
  })
})

