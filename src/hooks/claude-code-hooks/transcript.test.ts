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

  it("should not grow cached base entries across sequential transcript rebuilds", async () => {
    // given
    const client = createMockClient([])

    // when
    const firstPath = await buildTranscriptFromSession(
      client,
      "ses_sequential",
      "/tmp",
      "bash",
      { command: "echo first" }
    )
    if (firstPath) {
      const firstLines = readFileSync(firstPath, "utf-8").trim().split("\n")
      expect(firstLines).toHaveLength(1)
      expect(firstLines[0]).toContain("Bash")
    }

    const secondPath = await buildTranscriptFromSession(
      client,
      "ses_sequential",
      "/tmp",
      "read",
      { filePath: "/tmp/second.txt" }
    )
    const secondLines = secondPath ? readFileSync(secondPath, "utf-8").trim().split("\n") : []

    const thirdPath = await buildTranscriptFromSession(
      client,
      "ses_sequential",
      "/tmp",
      "write",
      { filePath: "/tmp/third.txt", content: "third" }
    )

    // then
    expect(firstPath).not.toBeNull()
    expect(secondPath).not.toBeNull()
    expect(thirdPath).not.toBeNull()

    if (secondPath && thirdPath) {
      expect(secondLines).toHaveLength(1)
      expect(secondLines[0]).toContain("Read")

      const thirdLines = readFileSync(thirdPath, "utf-8").trim().split("\n")
      expect(thirdLines).toHaveLength(1)
      expect(thirdLines[0]).toContain("Write")
    }

    // Cached previous temp files should be replaced on rebuild
    if (firstPath) {
      expect(existsSync(firstPath)).toBe(false)
    }

    deleteTempTranscript(firstPath)
    deleteTempTranscript(secondPath)
    deleteTempTranscript(thirdPath)
  })

  it("cleans up previous temp transcript files when rebuilding cached transcripts", async () => {
    // given
    const client = createMockClient([])

    // when
    const firstPath = await buildTranscriptFromSession(
      client,
      "ses_cleanup",
      "/tmp",
      "bash",
      { command: "echo first" }
    )
    const secondPath = await buildTranscriptFromSession(
      client,
      "ses_cleanup",
      "/tmp",
      "read",
      { filePath: "/tmp/second.txt" }
    )

    // then
    expect(firstPath).not.toBeNull()
    expect(secondPath).not.toBeNull()

    if (firstPath && secondPath) {
      expect(existsSync(firstPath)).toBe(false)
      expect(existsSync(secondPath)).toBe(true)
    }

    deleteTempTranscript(firstPath)
    deleteTempTranscript(secondPath)
  })
})
