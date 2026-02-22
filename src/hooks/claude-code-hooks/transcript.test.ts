import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { existsSync, unlinkSync, readFileSync } from "fs"
import {
  buildTranscriptFromSession,
  deleteTempTranscript,
  clearTranscriptCache,
} from "./transcript"

function createMockClient(messages: unknown[] = []) {
  return {
    session: {
      messages: mock(() =>
        Promise.resolve({
          data: messages,
        })
      ),
    },
  }
}

describe("transcript caching", () => {
  afterEach(() => {
    clearTranscriptCache()
  })

  // #given same session called twice
  // #when buildTranscriptFromSession is invoked
  // #then session.messages() should be called only once (cached)
  it("should cache transcript and not re-fetch for same session", async () => {
    const client = createMockClient([
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "ls" } },
          },
        ],
      },
    ])

    const path1 = await buildTranscriptFromSession(
      client,
      "ses_cache1",
      "/tmp",
      "bash",
      { command: "echo hi" }
    )

    const path2 = await buildTranscriptFromSession(
      client,
      "ses_cache1",
      "/tmp",
      "read",
      { path: "/tmp/file" }
    )

    // session.messages() called only once
    expect(client.session.messages).toHaveBeenCalledTimes(1)

    // Both return valid paths
    expect(path1).not.toBeNull()
    expect(path2).not.toBeNull()

    // Second call should append the new tool entry
    if (path2) {
      const content = readFileSync(path2, "utf-8")
      expect(content).toContain("Read")
    }

    deleteTempTranscript(path1)
    deleteTempTranscript(path2)
  })

  // #given different sessions
  // #when buildTranscriptFromSession called for each
  // #then session.messages() should be called for each
  it("should not share cache between different sessions", async () => {
    const client = createMockClient([])

    await buildTranscriptFromSession(client, "ses_a", "/tmp", "bash", {})
    await buildTranscriptFromSession(client, "ses_b", "/tmp", "bash", {})

    expect(client.session.messages).toHaveBeenCalledTimes(2)

    clearTranscriptCache()
  })

  // #given clearTranscriptCache is called
  // #when buildTranscriptFromSession called again
  // #then should re-fetch
  it("should re-fetch after cache is cleared", async () => {
    const client = createMockClient([])

    await buildTranscriptFromSession(client, "ses_clear", "/tmp", "bash", {})
    clearTranscriptCache()
    await buildTranscriptFromSession(client, "ses_clear", "/tmp", "bash", {})

    expect(client.session.messages).toHaveBeenCalledTimes(2)
  })
})
