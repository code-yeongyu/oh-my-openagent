import { describe, expect, it, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { detectErrorType, createSessionRecoveryHook } from "./index"
import * as storage from "./storage"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE, MESSAGE_STORAGE } from "./constants"

describe("detectErrorType", () => {
  describe("thinking_block_order errors", () => {
    it("should detect 'first block' error pattern", () => {
      // #given an error about thinking being the first block
      const error = {
        message: "messages.0: thinking block must not be the first block",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'must start with' error pattern", () => {
      // #given an error about message must start with something
      const error = {
        message: "messages.5: thinking must start with text or tool_use",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'preceeding' error pattern", () => {
      // #given an error about preceeding block
      const error = {
        message: "messages.10: thinking requires preceeding text block",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'expected/found' error pattern", () => {
      // #given an error about expected vs found
      const error = {
        message: "messages.3: thinking block expected text but found tool_use",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'final block cannot be thinking' error pattern", () => {
      // #given an error about final block cannot be thinking
      const error = {
        message:
          "messages.125: The final block in an assistant message cannot be thinking.",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'final block' variant error pattern", () => {
      // #given an error mentioning final block with thinking
      const error = {
        message:
          "messages.17: thinking in the final block is not allowed in assistant messages",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'cannot be thinking' error pattern", () => {
      // #given an error using 'cannot be thinking' phrasing
      const error = {
        message:
          "messages.219: The last block in an assistant message cannot be thinking content",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })
  })

  describe("tool_result_missing errors", () => {
    it("should detect tool_use/tool_result mismatch", () => {
      // #given an error about tool_use without tool_result
      const error = {
        message: "tool_use block requires corresponding tool_result",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return tool_result_missing
      expect(result).toBe("tool_result_missing")
    })
  })

  describe("thinking_disabled_violation errors", () => {
    it("should detect thinking disabled violation", () => {
      // #given an error about thinking being disabled
      const error = {
        message:
          "thinking is disabled for this model and cannot contain thinking blocks",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_disabled_violation
      expect(result).toBe("thinking_disabled_violation")
    })
  })

  describe("unrecognized errors", () => {
    it("should return null for unrecognized error patterns", () => {
      // #given an unrelated error
      const error = {
        message: "Rate limit exceeded",
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return null
      expect(result).toBeNull()
    })

    it("should return null for empty error", () => {
      // #given an empty error
      const error = {}

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return null
      expect(result).toBeNull()
    })

    it("should return null for null error", () => {
      // #given a null error
      const error = null

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return null
      expect(result).toBeNull()
    })
  })

  describe("nested error objects", () => {
    it("should detect error in data.error.message path", () => {
      // #given an error with nested structure
      const error = {
        data: {
          error: {
            message:
              "messages.163: The final block in an assistant message cannot be thinking.",
          },
        },
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect error in error.message path", () => {
      // #given an error with error.message structure
      const error = {
        error: {
          message: "messages.169: final block cannot be thinking",
        },
      }

      // #when detectErrorType is called
      const result = detectErrorType(error)

      // #then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })
  })
})

describe("recoverToolResultMissing", () => {
  const TEST_SESSION_ID = "ses_test_recovery_123"
  const TEST_USER_MSG_ID = "msg_user_001"
  const TEST_PREV_ASSISTANT_ID = "msg_assistant_001"  // Previous assistant with tools
  const TEST_FAILED_ASSISTANT_ID = "msg_assistant_002"  // Failed message (no parts)
  const TEST_TOOL_CALL_ID = "toolu_01abc123xyz"

  // Storage paths for test cleanup
  const getTestPartDir = (msgId: string) => join(PART_STORAGE, msgId)
  const getTestMessageDir = () => join(MESSAGE_STORAGE, TEST_SESSION_ID)

  beforeEach(() => {
    // Create test directories
    const partDir = getTestPartDir(TEST_PREV_ASSISTANT_ID)
    const msgDir = getTestMessageDir()

    if (!existsSync(partDir)) {
      mkdirSync(partDir, { recursive: true })
    }
    if (!existsSync(msgDir)) {
      mkdirSync(msgDir, { recursive: true })
    }

    // Write previous assistant message with tool parts
    const toolPart = {
      id: "prt_001",
      sessionID: TEST_SESSION_ID,
      messageID: TEST_PREV_ASSISTANT_ID,
      type: "tool",
      callID: TEST_TOOL_CALL_ID,
      tool: "delegate_task",
      state: {
        status: "completed",
        input: { prompt: "test" },
        output: "done"
      }
    }
    writeFileSync(
      join(partDir, "prt_001.json"),
      JSON.stringify(toolPart, null, 2)
    )

    // Write message metadata for both messages
    const prevAssistantMeta = {
      id: TEST_PREV_ASSISTANT_ID,
      sessionID: TEST_SESSION_ID,
      role: "assistant",
      parentID: TEST_USER_MSG_ID,
      time: { created: 1000, completed: 2000 }
    }
    const failedAssistantMeta = {
      id: TEST_FAILED_ASSISTANT_ID,
      sessionID: TEST_SESSION_ID,
      role: "assistant",
      parentID: TEST_USER_MSG_ID,
      time: { created: 3000 }
      // Note: no 'completed' - this message failed
    }
    writeFileSync(
      join(msgDir, `${TEST_PREV_ASSISTANT_ID}.json`),
      JSON.stringify(prevAssistantMeta, null, 2)
    )
    writeFileSync(
      join(msgDir, `${TEST_FAILED_ASSISTANT_ID}.json`),
      JSON.stringify(failedAssistantMeta, null, 2)
    )
  })

  afterEach(() => {
    // Cleanup test directories
    try {
      rmSync(getTestPartDir(TEST_PREV_ASSISTANT_ID), { recursive: true, force: true })
      rmSync(getTestPartDir(TEST_FAILED_ASSISTANT_ID), { recursive: true, force: true })
      rmSync(getTestMessageDir(), { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it("should find tool_use from PREVIOUS assistant message when failed message has no parts", async () => {
    // #given
    // - Previous assistant message (msg_assistant_001) has tool parts with callID
    // - Failed assistant message (msg_assistant_002) has NO parts (API never responded)
    // - Error says tool_use without tool_result

    // Mock the client
    let promptCalled = false
    let promptBody: unknown = null
    const mockClient = {
      session: {
        abort: mock(() => Promise.resolve()),
        messages: mock(() => Promise.resolve({
          data: [
            {
              info: {
                id: TEST_PREV_ASSISTANT_ID,
                role: "assistant",
                sessionID: TEST_SESSION_ID,
              },
              parts: [
                {
                  type: "tool",
                  callID: TEST_TOOL_CALL_ID,
                  tool: "delegate_task",
                  state: { status: "completed", input: {} }
                }
              ]
            },
            {
              info: {
                id: TEST_FAILED_ASSISTANT_ID,
                role: "assistant",
                sessionID: TEST_SESSION_ID,
              },
              parts: []  // EMPTY - this is the bug scenario
            }
          ]
        })),
        prompt: mock((args: unknown) => {
          promptCalled = true
          promptBody = (args as { body: unknown }).body
          return Promise.resolve()
        })
      },
      tui: {
        showToast: mock(() => Promise.resolve())
      }
    }

    const mockCtx = {
      client: mockClient,
      directory: "/test"
    }

    const hook = createSessionRecoveryHook(mockCtx as any)

    // #when - recovery is triggered for the failed message
    const result = await hook.handleSessionRecovery({
      id: TEST_FAILED_ASSISTANT_ID,
      role: "assistant",
      sessionID: TEST_SESSION_ID,
      error: {
        message: `messages.1: tool_use ids were found without tool_result blocks immediately after: ${TEST_TOOL_CALL_ID}`
      }
    })

    // #then - should have called prompt with tool_result for the tool from PREVIOUS message
    expect(result).toBe(true)
    expect(promptCalled).toBe(true)
    expect(promptBody).toBeDefined()

    const body = promptBody as { parts: Array<{ type: string; tool_use_id: string }> }
    expect(body.parts).toBeDefined()
    expect(body.parts.length).toBeGreaterThan(0)
    expect(body.parts[0].type).toBe("tool_result")
    expect(body.parts[0].tool_use_id).toBe(TEST_TOOL_CALL_ID)
  })
})
