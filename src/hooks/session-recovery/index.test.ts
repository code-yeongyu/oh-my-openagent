import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { detectErrorType } from "./index"
import { prependThinkingPart, prependThinkingPartAsync } from "./storage/thinking-prepend"
import { PART_STORAGE } from "../../shared/opencode-storage-paths"

const { describe, expect, it, mock } = require("bun:test")

describe("detectErrorType", () => {
  describe("thinking_block_order errors", () => {
    it("should detect 'first block' error pattern", () => {
      // given an error about thinking being the first block
      const error = {
        message: "messages.0: thinking block must not be the first block",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'must start with' error pattern", () => {
      // given an error about message must start with something
      const error = {
        message: "messages.5: thinking must start with text or tool_use",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'preceeding' error pattern", () => {
      // given an error about preceeding block
      const error = {
        message: "messages.10: thinking requires preceeding text block",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'expected/found' error pattern", () => {
      // given an error about expected vs found
      const error = {
        message: "messages.3: thinking block expected text but found tool_use",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'final block cannot be thinking' error pattern", () => {
      // given an error about final block cannot be thinking
      const error = {
        message:
          "messages.125: The final block in an assistant message cannot be thinking.",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'final block' variant error pattern", () => {
      // given an error mentioning final block with thinking
      const error = {
        message:
          "messages.17: thinking in the final block is not allowed in assistant messages",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect 'cannot be thinking' error pattern", () => {
      // given an error using 'cannot be thinking' phrasing
      const error = {
        message:
          "messages.219: The last block in an assistant message cannot be thinking content",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })
  })

  describe("tool_result_missing errors", () => {
    it("should detect tool_use/tool_result mismatch", () => {
      // given an error about tool_use without tool_result
      const error = {
        message: "tool_use block requires corresponding tool_result",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return tool_result_missing
      expect(result).toBe("tool_result_missing")
    })
  })

  describe("thinking_disabled_violation errors", () => {
    it("should detect thinking disabled violation", () => {
      // given an error about thinking being disabled
      const error = {
        message:
          "thinking is disabled for this model and cannot contain thinking blocks",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_disabled_violation
      expect(result).toBe("thinking_disabled_violation")
    })
  })

  describe("assistant_prefill_unsupported errors", () => {
    it("should detect assistant message prefill error from direct message", () => {
      //#given an error about assistant message prefill not being supported
      const error = {
        message: "This model does not support assistant message prefill. The conversation must end with a user message.",
      }

      //#when detectErrorType is called
      const result = detectErrorType(error)

      //#then should return assistant_prefill_unsupported
      expect(result).toBe("assistant_prefill_unsupported")
    })

    it("should detect assistant message prefill error from nested error object", () => {
      //#given an Anthropic API error with nested structure matching the real error format
      const error = {
        error: {
          type: "invalid_request_error",
          message: "This model does not support assistant message prefill. The conversation must end with a user message.",
        },
      }

      //#when detectErrorType is called
      const result = detectErrorType(error)

      //#then should return assistant_prefill_unsupported
      expect(result).toBe("assistant_prefill_unsupported")
    })

    it("should detect error with only 'conversation must end with a user message' fragment", () => {
      //#given an error containing only the user message requirement
      const error = {
        message: "The conversation must end with a user message.",
      }

      //#when detectErrorType is called
      const result = detectErrorType(error)

      //#then should return assistant_prefill_unsupported
      expect(result).toBe("assistant_prefill_unsupported")
    })

    it("should detect error with only 'assistant message prefill' fragment", () => {
      //#given an error containing only the prefill mention
      const error = {
        message: "This model does not support assistant message prefill.",
      }

      //#when detectErrorType is called
      const result = detectErrorType(error)

      //#then should return assistant_prefill_unsupported
      expect(result).toBe("assistant_prefill_unsupported")
    })
  })

  describe("unrecognized errors", () => {
    it("should return null for unrecognized error patterns", () => {
      // given an unrelated error
      const error = {
        message: "Rate limit exceeded",
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return null
      expect(result).toBeNull()
    })

    it("should return null for empty error", () => {
      // given an empty error
      const error = {}

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return null
      expect(result).toBeNull()
    })

    it("should return null for null error", () => {
      // given a null error
      const error = null

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return null
      expect(result).toBeNull()
    })
  })

  describe("nested error objects", () => {
    it("should detect error in data.error.message path", () => {
      // given an error with nested structure
      const error = {
        data: {
          error: {
            message:
              "messages.163: The final block in an assistant message cannot be thinking.",
          },
        },
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect error in error.message path", () => {
      // given an error with error.message structure
      const error = {
        error: {
          message: "messages.169: final block cannot be thinking",
        },
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order
      expect(result).toBe("thinking_block_order")
    })

    it("should detect thinking_block_order even when error message contains tool_use/tool_result in docs URL", () => {
      // given Anthropic's extended thinking error with tool_use/tool_result in the documentation text
      const error = {
        error: {
          type: "invalid_request_error",
          message:
            "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `text`. " +
            "When `thinking` is enabled, a final `assistant` message must start with a thinking block " +
            "(preceeding the lastmost set of `tool_use` and `tool_result` blocks). " +
            "We recommend you include thinking blocks from previous turns.",
        },
      }

      // when detectErrorType is called
      const result = detectErrorType(error)

      // then should return thinking_block_order (NOT tool_result_missing)
      expect(result).toBe("thinking_block_order")
    })
  })
})

type StoredPartRecord = {
  id: string
  sessionID: string
  messageID: string
  type: string
  signature?: string
  thinking?: string
  text?: string
}

function cleanupParts(messageID: string): void {
  rmSync(join(PART_STORAGE, messageID), { recursive: true, force: true })
}

describe("thinking-prepend", () => {
  it("writes the original signed thinking part verbatim for file-backed recovery", () => {
    const sessionID = "ses_thinking_prepend_sync"
    const targetMessageID = "msg_target_signed"
    const originalPart = {
      id: "prt_prev_signed",
      sessionID,
      messageID: "msg_prev_signed",
      type: "thinking",
      thinking: "prior reasoning",
      signature: "sig_prev",
    } as const satisfies StoredPartRecord

    const result = prependThinkingPart(sessionID, targetMessageID, {
      isSqliteBackend: () => false,
      patchPart: async () => true,
      log: mock(() => {}),
      findLastThinkingPart: () => originalPart,
      findLastThinkingPartFromSDK: async () => null,
      readTargetPartIDs: () => ["prt_target_text"],
      readTargetPartIDsFromSDK: async () => [],
    })

    expect(result).toBe(true)
    const writtenPath = join(PART_STORAGE, targetMessageID, `${originalPart.id}.json`)
    expect(existsSync(writtenPath)).toBe(true)
    expect(JSON.parse(readFileSync(writtenPath, "utf-8"))).toEqual(originalPart)

    cleanupParts(targetMessageID)
  })

  it("returns false without writing when no signed thinking part exists in history", () => {
    const sessionID = "ses_thinking_prepend_sync_missing"
    const targetMessageID = "msg_target_missing"

    const result = prependThinkingPart(sessionID, targetMessageID, {
      isSqliteBackend: () => false,
      patchPart: async () => true,
      log: mock(() => {}),
      findLastThinkingPart: () => null,
      findLastThinkingPartFromSDK: async () => null,
      readTargetPartIDs: () => [],
      readTargetPartIDsFromSDK: async () => [],
    })

    expect(result).toBe(false)
    expect(existsSync(join(PART_STORAGE, targetMessageID))).toBe(false)

    cleanupParts(targetMessageID)
  })

  it("returns false immediately when sqlite backend is active", () => {
    const result = prependThinkingPart("ses_sqlite", "msg_sqlite", {
      isSqliteBackend: () => true,
      patchPart: async () => true,
      log: mock(() => {}),
      findLastThinkingPart: () => null,
      findLastThinkingPartFromSDK: async () => null,
      readTargetPartIDs: () => [],
      readTargetPartIDsFromSDK: async () => [],
    })

    expect(result).toBe(false)
  })

  it("returns false when the reused signed thinking part would not sort before target parts", () => {
    const sessionID = "ses_thinking_prepend_sync_out_of_order"
    const targetMessageID = "msg_target_out_of_order"
    const originalPart = {
      id: "prt_z_reused",
      sessionID,
      messageID: "msg_prev_signed",
      type: "thinking",
      thinking: "prior reasoning",
      signature: "sig_prev",
    } as const satisfies StoredPartRecord

    const result = prependThinkingPart(sessionID, targetMessageID, {
      isSqliteBackend: () => false,
      patchPart: async () => true,
      log: mock(() => {}),
      findLastThinkingPart: () => originalPart,
      findLastThinkingPartFromSDK: async () => null,
      readTargetPartIDs: () => ["prt_a_target"],
      readTargetPartIDsFromSDK: async () => [],
    })

    expect(result).toBe(false)
    expect(existsSync(join(PART_STORAGE, targetMessageID))).toBe(false)
  })

  it("patches the original signed thinking part verbatim for sdk-backed recovery", async () => {
    const prependThinkingPartAsyncUntyped = Reflect.get(
      { prependThinkingPartAsync },
      "prependThinkingPartAsync"
    )
    const sessionID = "ses_thinking_prepend_async"
    const targetMessageID = "msg_target_async"
    const patchPartMock = mock(async () => true)
    const originalPart = {
      id: "prt_prev_async",
      type: "thinking",
      thinking: "prior reasoning",
      signature: "sig_async",
    } as const
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: "msg_prev_async", role: "assistant" },
              parts: [originalPart],
            },
            {
              info: { id: targetMessageID, role: "assistant" },
              parts: [{ id: "prt_target_text", type: "text", text: "tool result" }],
            },
          ],
        }),
      },
    }

    const result = await Reflect.apply(prependThinkingPartAsyncUntyped, undefined, [
      client,
      sessionID,
      targetMessageID,
      {
        isSqliteBackend: () => false,
        patchPart: patchPartMock,
        log: mock(() => {}),
        findLastThinkingPart: () => null,
        findLastThinkingPartFromSDK: async () => originalPart,
        readTargetPartIDs: () => [],
        readTargetPartIDsFromSDK: async () => ["prt_target_text"],
      },
    ])

    expect(result).toBe(true)
    expect(patchPartMock).toHaveBeenCalledTimes(1)
    expect(patchPartMock.mock.calls[0]).toEqual([
      client,
      sessionID,
      targetMessageID,
      "prt_prev_async",
      originalPart,
    ])
  })

  it("returns false without patching when sdk history has no signed thinking part", async () => {
    const prependThinkingPartAsyncUntyped = Reflect.get(
      { prependThinkingPartAsync },
      "prependThinkingPartAsync"
    )
    const sessionID = "ses_thinking_prepend_async_missing"
    const targetMessageID = "msg_target_async_missing"
    const patchPartMock = mock(async () => true)
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: "msg_prev_async", role: "assistant" },
              parts: [{ id: "prt_prev_reasoning", type: "reasoning", text: "unsigned reasoning" }],
            },
            {
              info: { id: targetMessageID, role: "assistant" },
              parts: [{ id: "prt_target_text", type: "text", text: "tool result" }],
            },
          ],
        }),
      },
    }

    const result = await Reflect.apply(prependThinkingPartAsyncUntyped, undefined, [
      client,
      sessionID,
      targetMessageID,
      {
        isSqliteBackend: () => false,
        patchPart: patchPartMock,
        log: mock(() => {}),
        findLastThinkingPart: () => null,
        findLastThinkingPartFromSDK: async () => null,
        readTargetPartIDs: () => [],
        readTargetPartIDsFromSDK: async () => ["prt_target_text"],
      },
    ])

    expect(result).toBe(false)
    expect(patchPartMock).toHaveBeenCalledTimes(0)
  })

  it("returns false when the sdk reused signed thinking part would not sort before target parts", async () => {
    const prependThinkingPartAsyncUntyped = Reflect.get(
      { prependThinkingPartAsync },
      "prependThinkingPartAsync"
    )
    const sessionID = "ses_thinking_prepend_async_out_of_order"
    const targetMessageID = "msg_target_async_out_of_order"
    const patchPartMock = mock(async () => true)
    const originalPart = {
      id: "prt_z_reused",
      type: "thinking",
      thinking: "prior reasoning",
      signature: "sig_async",
    } as const
    const client = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }

    const result = await Reflect.apply(prependThinkingPartAsyncUntyped, undefined, [
      client,
      sessionID,
      targetMessageID,
      {
        isSqliteBackend: () => false,
        patchPart: patchPartMock,
        log: mock(() => {}),
        findLastThinkingPart: () => null,
        findLastThinkingPartFromSDK: async () => originalPart,
        readTargetPartIDs: () => [],
        readTargetPartIDsFromSDK: async () => ["prt_a_target"],
      },
    ])

    expect(result).toBe(false)
    expect(patchPartMock).toHaveBeenCalledTimes(0)
  })
})
