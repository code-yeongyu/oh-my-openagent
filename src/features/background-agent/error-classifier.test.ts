import { describe, test, expect } from "bun:test"
import {
  isRecord,
  isAbortedSessionError,
  getErrorText,
  extractErrorName,
  extractErrorMessage,
  getSessionErrorMessage,
} from "./error-classifier"

describe("isRecord", () => {
  describe("#given null or primitive values", () => {
    test("returns false for null", () => {
      expect(isRecord(null)).toBe(false)
    })

    test("returns false for undefined", () => {
      expect(isRecord(undefined)).toBe(false)
    })

    test("returns false for string", () => {
      expect(isRecord("hello")).toBe(false)
    })

    test("returns false for number", () => {
      expect(isRecord(42)).toBe(false)
    })

    test("returns false for boolean", () => {
      expect(isRecord(true)).toBe(false)
    })

    test("returns true for array (arrays are objects)", () => {
      expect(isRecord([1, 2, 3])).toBe(true)
    })
  })

  describe("#given plain objects", () => {
    test("returns true for empty object", () => {
      expect(isRecord({})).toBe(true)
    })

    test("returns true for object with properties", () => {
      expect(isRecord({ key: "value" })).toBe(true)
    })

    test("returns true for object with nested objects", () => {
      expect(isRecord({ nested: { deep: true } })).toBe(true)
    })
  })

  describe("#given Error instances", () => {
    test("returns true for Error instance", () => {
      expect(isRecord(new Error("test"))).toBe(true)
    })

    test("returns true for TypeError instance", () => {
      expect(isRecord(new TypeError("test"))).toBe(true)
    })
  })
})

describe("isAbortedSessionError", () => {
  describe("#given error with aborted message", () => {
    test("returns true for string containing aborted", () => {
      expect(isAbortedSessionError("Session aborted")).toBe(true)
    })

    test("returns true for string with ABORTED uppercase", () => {
      expect(isAbortedSessionError("Session ABORTED")).toBe(true)
    })

    test("returns true for Error with aborted in message", () => {
      expect(isAbortedSessionError(new Error("Session aborted"))).toBe(true)
    })

    test("returns true for object with message containing aborted", () => {
      expect(isAbortedSessionError({ message: "The session was aborted" })).toBe(true)
    })
  })

  describe("#given error without aborted message", () => {
    test("returns false for string without aborted", () => {
      expect(isAbortedSessionError("Session completed")).toBe(false)
    })

    test("returns false for Error without aborted", () => {
      expect(isAbortedSessionError(new Error("Something went wrong"))).toBe(false)
    })

    test("returns false for empty string", () => {
      expect(isAbortedSessionError("")).toBe(false)
    })
  })

  describe("#given invalid inputs", () => {
    test("returns false for null", () => {
      expect(isAbortedSessionError(null)).toBe(false)
    })

    test("returns false for undefined", () => {
      expect(isAbortedSessionError(undefined)).toBe(false)
    })

    test("returns false for object without message", () => {
      expect(isAbortedSessionError({ code: "ABORTED" })).toBe(false)
    })
  })
})

describe("getErrorText", () => {
  describe("#given string input", () => {
    test("returns the string as-is", () => {
      expect(getErrorText("Something went wrong")).toBe("Something went wrong")
    })

    test("returns empty string for empty string", () => {
      expect(getErrorText("")).toBe("")
    })
  })

  describe("#given Error instance", () => {
    test("returns name and message format", () => {
      expect(getErrorText(new Error("test message"))).toBe("Error: test message")
    })

    test("returns TypeError format", () => {
      expect(getErrorText(new TypeError("type error"))).toBe("TypeError: type error")
    })
  })

  describe("#given object with message property", () => {
    test("returns message property as string", () => {
      expect(getErrorText({ message: "custom error" })).toBe("custom error")
    })

    test("returns name property when message not available", () => {
      expect(getErrorText({ name: "CustomError" })).toBe("CustomError")
    })

    test("prefers message over name", () => {
      expect(getErrorText({ name: "CustomError", message: "error message" })).toBe("error message")
    })
  })

  describe("#given invalid inputs", () => {
    test("returns empty string for null", () => {
      expect(getErrorText(null)).toBe("")
    })

    test("returns empty string for undefined", () => {
      expect(getErrorText(undefined)).toBe("")
    })

    test("returns empty string for object without message or name", () => {
      expect(getErrorText({ code: 500 })).toBe("")
    })
  })
})

describe("extractErrorName", () => {
  describe("#given Error instance", () => {
    test("returns Error for generic Error", () => {
      expect(extractErrorName(new Error("test"))).toBe("Error")
    })

    test("returns TypeError name", () => {
      expect(extractErrorName(new TypeError("test"))).toBe("TypeError")
    })

    test("returns RangeError name", () => {
      expect(extractErrorName(new RangeError("test"))).toBe("RangeError")
    })
  })

  describe("#given plain object with name property", () => {
    test("returns name property when string", () => {
      expect(extractErrorName({ name: "CustomError" })).toBe("CustomError")
    })

    test("returns undefined when name is not string", () => {
      expect(extractErrorName({ name: 123 })).toBe(undefined)
    })
  })

  describe("#given invalid inputs", () => {
    test("returns undefined for null", () => {
      expect(extractErrorName(null)).toBe(undefined)
    })

    test("returns undefined for undefined", () => {
      expect(extractErrorName(undefined)).toBe(undefined)
    })

    test("returns undefined for string", () => {
      expect(extractErrorName("Error message")).toBe(undefined)
    })

    test("returns undefined for object without name property", () => {
      expect(extractErrorName({ message: "test" })).toBe(undefined)
    })
  })
})

describe("extractErrorMessage", () => {
  describe("#given string input", () => {
    test("returns the string as-is", () => {
      expect(extractErrorMessage("error message")).toBe("error message")
    })

    test("returns undefined for empty string", () => {
      expect(extractErrorMessage("")).toBe(undefined)
    })
  })

  describe("#given Error instance", () => {
    test("returns error message", () => {
      expect(extractErrorMessage(new Error("test error"))).toBe("test error")
    })

    test("returns empty string for Error with no message", () => {
      expect(extractErrorMessage(new Error())).toBe("")
    })
  })

  describe("#given object with message property", () => {
    test("returns message property", () => {
      expect(extractErrorMessage({ message: "custom message" })).toBe("custom message")
    })

    test("falls through to JSON.stringify for empty message value", () => {
      expect(extractErrorMessage({ message: "" })).toBe('{"message":""}')
    })
  })

  describe("#given nested error structure", () => {
    test("extracts message from nested error object", () => {
      expect(extractErrorMessage({ error: { message: "nested error" } })).toBe("nested error")
    })

    test("extracts message from data.error structure", () => {
      expect(extractErrorMessage({ data: { error: "data error" } })).toBe("data error")
    })

    test("extracts message from cause property", () => {
      expect(extractErrorMessage({ cause: "cause error" })).toBe("cause error")
    })

    test("extracts message from cause object with message", () => {
      expect(extractErrorMessage({ cause: { message: "cause message" } })).toBe("cause message")
    })
  })

  describe("#given complex error with data wrapper", () => {
    test("extracts from error.data.message", () => {
      const error = {
        data: {
          message: "data message",
        },
      }
      expect(extractErrorMessage(error)).toBe("data message")
    })

    test("prefers top over nested-level message", () => {
      const error = {
        message: "top level",
        data: { message: "nested" },
      }
      expect(extractErrorMessage(error)).toBe("top level")
    })
  })

  describe("#given invalid inputs", () => {
    test("returns undefined for null", () => {
      expect(extractErrorMessage(null)).toBe(undefined)
    })

    test("returns undefined for undefined", () => {
      expect(extractErrorMessage(undefined)).toBe(undefined)
    })
  })

  describe("#given object without extractable message", () => {
    test("falls back to JSON.stringify for object", () => {
      const obj = { code: 500, details: "error" }
      const result = extractErrorMessage(obj)
      expect(result).toContain('"code":500')
    })

    test("falls back to String() for non-serializable object", () => {
      const circular: Record<string, unknown> = { a: 1 }
      circular.self = circular
      const result = extractErrorMessage(circular)
      expect(result).toBe("[object Object]")
    })
  })
})

describe("getSessionErrorMessage", () => {
  describe("#given valid error properties", () => {
    test("extracts message from error.message", () => {
      const properties = { error: { message: "session error" } }
      expect(getSessionErrorMessage(properties)).toBe("session error")
    })

    test("extracts message from error.data.message", () => {
      const properties = {
        error: {
          data: { message: "data error message" },
        },
      }
      expect(getSessionErrorMessage(properties)).toBe("data error message")
    })

    test("prefers error.data.message over error.message", () => {
      const properties = {
        error: {
          message: "top level",
          data: { message: "nested" },
        },
      }
      expect(getSessionErrorMessage(properties)).toBe("nested")
    })
  })

  describe("#given missing or invalid properties", () => {
    test("returns undefined when error is missing", () => {
      expect(getSessionErrorMessage({})).toBe(undefined)
    })

    test("returns undefined when error is null", () => {
      expect(getSessionErrorMessage({ error: null })).toBe(undefined)
    })

    test("returns undefined when error is string", () => {
      expect(getSessionErrorMessage({ error: "error string" })).toBe(undefined)
    })

    test("returns undefined when data is not an object", () => {
      expect(getSessionErrorMessage({ error: { data: "not an object" } })).toBe(undefined)
    })

    test("returns undefined when message is not string", () => {
      expect(getSessionErrorMessage({ error: { message: 123 } })).toBe(undefined)
    })

    test("returns undefined when data.message is not string", () => {
      expect(getSessionErrorMessage({ error: { data: { message: null } } })).toBe(undefined)
    })
  })
})
