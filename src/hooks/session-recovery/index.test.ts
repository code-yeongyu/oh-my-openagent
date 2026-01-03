import { describe, expect, it } from "bun:test"
import { detectErrorType } from "./index"

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
