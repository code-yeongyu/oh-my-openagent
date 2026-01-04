import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearCachedClaudeTranscript,
  getPostToolUseTranscriptPath,
} from "./transcript"

describe("claude-code-hooks transcript caching", () => {
  const TEST_DIR = join(tmpdir(), `claude-transcript-test-${Date.now()}`)

  const createClient = () => {
    let messagesCalls = 0
    const client = {
      session: {
        messages: async () => {
          messagesCalls++
          return {
            data: [
              {
                info: { role: "assistant" },
                parts: [
                  {
                    type: "tool",
                    tool: "read",
                    state: { status: "completed", input: { path: "README.md" } },
                  },
                ],
              },
            ],
          }
        },
      },
    }

    return { client, getCalls: () => messagesCalls }
  }

  afterEach(() => {
    clearCachedClaudeTranscript("session-1")
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("#given a session with cached transcript", () => {
    describe("#when called multiple times", () => {
      it("#then should reuse cached transcript and append entries", async () => {
        const { client, getCalls } = createClient()

        const first = await getPostToolUseTranscriptPath({
          client,
          sessionId: "session-1",
          directory: TEST_DIR,
          toolName: "Read",
          toolInput: { path: "README.md" },
        })

        expect(first).not.toBeNull()
        expect(getCalls()).toBe(1)
        expect(existsSync(first as string)).toBe(true)

        const firstLines = readFileSync(first as string, "utf-8")
          .trim()
          .split("\n")
        expect(firstLines.length).toBe(2)

        const second = await getPostToolUseTranscriptPath({
          client,
          sessionId: "session-1",
          directory: TEST_DIR,
          toolName: "Edit",
          toolInput: { oldString: "a", newString: "b" },
        })

        expect(second).toBe(first)
        expect(getCalls()).toBe(1)

        const secondLines = readFileSync(second as string, "utf-8")
          .trim()
          .split("\n")
        expect(secondLines.length).toBe(3)
      })
    })
  })
})
