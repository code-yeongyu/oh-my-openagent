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

  it("does not grow the cached baseEntries across sequential rebuilds (#3647)", async () => {
    // given: an initial fetch returning one completed tool, so baseEntries
    //        has length 1 after the first call's cache-miss path
    const client = createMockClient([
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "echo zero" } },
          },
        ],
      },
    ])

    // when: three back-to-back PostToolUse rebuilds within the cache TTL.
    // Snapshot each transcript's line count immediately, because
    // buildTranscriptFromSession unlinks the previous temp file on the
    // next call.
    const countLines = (path: string | null): number => {
      if (!path) return -1
      return readFileSync(path, "utf-8").trim().split("\n").length
    }

    const firstPath = await buildTranscriptFromSession(
      client,
      "ses_no_growth",
      "/tmp",
      "bash",
      { command: "echo first" }
    )
    const firstLines = countLines(firstPath)

    const secondPath = await buildTranscriptFromSession(
      client,
      "ses_no_growth",
      "/tmp",
      "read",
      { filePath: "/tmp/second.txt" }
    )
    const secondLines = countLines(secondPath)

    const thirdPath = await buildTranscriptFromSession(
      client,
      "ses_no_growth",
      "/tmp",
      "write",
      { filePath: "/tmp/third.txt", content: "third" }
    )
    const thirdContent = thirdPath ? readFileSync(thirdPath, "utf-8") : ""
    const thirdLines = thirdContent ? thirdContent.trim().split("\n").length : -1

    // then: session.messages() is fetched once and each transcript file is
    //       exactly `baseEntries (1) + current synthetic entry (1)` lines.
    //       Before #3647 was fixed the third file would have grown to 4
    //       lines because the synthetic current entry was being written
    //       back into the cached baseEntries on every call.
    expect(client.session.messages).toHaveBeenCalledTimes(1)
    expect(firstPath).not.toBeNull()
    expect(secondPath).not.toBeNull()
    expect(thirdPath).not.toBeNull()

    expect(firstLines).toBe(2)
    expect(secondLines).toBe(2)
    expect(thirdLines).toBe(2)

    // baseEntries contribution: the originally-fetched Bash entry
    expect(thirdContent).toContain("Bash")
    // current synthetic entry for this rebuild: Write
    expect(thirdContent).toContain("Write")
    // Read was a transient currentEntry from an earlier rebuild and must
    // not leak into a later transcript file via the cached baseline
    expect(thirdContent).not.toContain("Read")

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
