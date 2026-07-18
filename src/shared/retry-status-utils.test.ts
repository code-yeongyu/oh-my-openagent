import { describe, test, expect } from "bun:test"
import { normalizeRetryStatusMessage, extractRetryAttempt } from "./retry-status-utils"

describe("normalizeRetryStatusMessage", () => {
  describe("#given bracket-style retry messages", () => {
    test("#when message contains [retrying in ...attempt #N] pattern", () => {
      const input = "[retrying in 5s attempt #2]"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying]")
    })

    test("#when message has multiple spaces in bracket pattern", () => {
      const input = "[retrying in   10s   attempt   #3]"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying]")
    })

    test("#when message has uppercase RETRYING", () => {
      const input = "[RETRYING IN 5s ATTEMPT #1]"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying]")
    })

    test("#when message has mixed case", () => {
      const input = "[Retrying In 5s Attempt #4]"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying]")
    })
  })

  describe("#given inline retry messages", () => {
    test("#when message contains retrying in ...attempt #N pattern", () => {
      const input = "Error: retrying in 3s attempt #1"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("error: retrying")
    })

    test("#when message has multiple spaces in inline pattern", () => {
      const input = "Failed retrying in   2s   attempt   #5"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("failed retrying")
    })

    test("#when message has uppercase inline pattern", () => {
      const input = "RETRYING IN 10s ATTEMPT #2"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("retrying")
    })
  })

  describe("#given messages with extra whitespace", () => {
    test("#when message has multiple consecutive spaces", () => {
      const input = "Error:   [retrying in 5s attempt #1]   message"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("error: [retrying] message")
    })

    test("#when message has leading and trailing whitespace", () => {
      const input = "   [retrying in 5s attempt #1]   "
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying]")
    })

    test("#when message has tabs and spaces", () => {
      const input = "Error:\t[retrying in 5s attempt #1]\t message"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("error: [retrying] message")
    })
  })

  describe("#given messages without retry patterns", () => {
    test("#when message has no retry pattern", () => {
      const input = "Connection timeout"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("connection timeout")
    })

    test("#when message is empty string", () => {
      const input = ""
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("")
    })

    test("#when message has only whitespace", () => {
      const input = "   \t  "
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("")
    })
  })

  describe("#given complex messages", () => {
    test("#when message has both bracket and inline patterns", () => {
      const input = "[retrying in 5s attempt #1] and retrying in 3s attempt #2"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying] and retrying")
    })

    test("#when message has multiple bracket patterns", () => {
      const input = "[retrying in 5s attempt #1] [retrying in 3s attempt #2]"
      const result = normalizeRetryStatusMessage(input)
      expect(result).toBe("[retrying] [retrying]")
    })
  })
})

describe("extractRetryAttempt", () => {
  describe("#given numeric statusAttempt", () => {
    test("#when statusAttempt is a valid positive number", () => {
      const result = extractRetryAttempt(1, "any message")
      expect(result).toBe("1")
    })

    test("#when statusAttempt is zero", () => {
      const result = extractRetryAttempt(0, "any message")
      expect(result).toBe("0")
    })

    test("#when statusAttempt is a large number", () => {
      const result = extractRetryAttempt(999, "any message")
      expect(result).toBe("999")
    })

    test("#when statusAttempt is a decimal number", () => {
      const result = extractRetryAttempt(2.5, "any message")
      expect(result).toBe("2.5")
    })
  })

  describe("#given non-numeric statusAttempt, extract from message", () => {
    test("#when message contains attempt #N pattern", () => {
      const result = extractRetryAttempt(null, "retrying attempt #3")
      expect(result).toBe("3")
    })

    test("#when message has spaces around # symbol", () => {
      const result = extractRetryAttempt(undefined, "attempt # 5")
      expect(result).toBe("5")
    })

    test("#when message has uppercase ATTEMPT", () => {
      const result = extractRetryAttempt(null, "ATTEMPT #2")
      expect(result).toBe("2")
    })

    test("#when message has mixed case", () => {
      const result = extractRetryAttempt(undefined, "Attempt # 7")
      expect(result).toBe("7")
    })

    test("#when message has multiple attempt patterns, returns first match", () => {
      const result = extractRetryAttempt(null, "attempt #1 and attempt #2")
      expect(result).toBe("1")
    })

    test("#when message has attempt with leading zeros", () => {
      const result = extractRetryAttempt(null, "attempt #007")
      expect(result).toBe("007")
    })
  })

  describe("#given invalid statusAttempt and no match in message", () => {
    test("#when statusAttempt is NaN", () => {
      const result = extractRetryAttempt(NaN, "no attempt here")
      expect(result).toBe("?")
    })

    test("#when statusAttempt is Infinity", () => {
      const result = extractRetryAttempt(Infinity, "no attempt here")
      expect(result).toBe("?")
    })

    test("#when statusAttempt is negative Infinity", () => {
      const result = extractRetryAttempt(-Infinity, "no attempt here")
      expect(result).toBe("?")
    })

    test("#when statusAttempt is string and message has no pattern", () => {
      const result = extractRetryAttempt("not a number", "connection failed")
      expect(result).toBe("?")
    })

    test("#when statusAttempt is object and message has no pattern", () => {
      const result = extractRetryAttempt({}, "timeout occurred")
      expect(result).toBe("?")
    })

    test("#when message is empty string", () => {
      const result = extractRetryAttempt(null, "")
      expect(result).toBe("?")
    })

    test("#when message has malformed attempt pattern", () => {
      const result = extractRetryAttempt(undefined, "attempt # abc")
      expect(result).toBe("?")
    })
  })

  describe("#given edge cases", () => {
    test("#when statusAttempt is 0 (falsy but valid)", () => {
      const result = extractRetryAttempt(0, "attempt #5")
      expect(result).toBe("0")
    })

    test("#when statusAttempt is false, falls through to message extraction", () => {
      const result = extractRetryAttempt(false, "attempt #3")
      expect(result).toBe("3")
    })

    test("#when statusAttempt is empty string, falls through to message extraction", () => {
      const result = extractRetryAttempt("", "attempt #2")
      expect(result).toBe("2")
    })

    test("#when statusAttempt is null and message has pattern", () => {
      const result = extractRetryAttempt(null, "retrying attempt #4")
      expect(result).toBe("4")
    })

    test("#when statusAttempt is undefined and message has pattern", () => {
      const result = extractRetryAttempt(undefined, "error attempt #6")
      expect(result).toBe("6")
    })
  })
})
