import { describe, expect, test } from "bun:test"
import {
  parseLogLine,
  parseLogFile,
  detectLevel,
  extractSource,
  extractJsonData,
  filterByLevel,
  getLastNEntries,
} from "./parser"
import type { LogEntry } from "./types"

describe("parser", () => {
  describe("detectLevel", () => {
    test("detects error level from message", () => {
      // #given: a message containing error keywords
      const message = "Something failed to load"

      // #when: detecting the level
      const level = detectLevel(message)

      // #then: should return error
      expect(level).toBe("error")
    })

    test("detects warning level from message", () => {
      // #given: a message containing warning keywords
      const message = "Deprecated function used"

      // #when: detecting the level
      const level = detectLevel(message)

      // #then: should return warn
      expect(level).toBe("warn")
    })

    test("defaults to info for regular messages", () => {
      // #given: a message without error/warning keywords
      const message = "Config loaded successfully"

      // #when: detecting the level
      const level = detectLevel(message)

      // #then: should return info
      expect(level).toBe("info")
    })
  })

  describe("extractSource", () => {
    test("extracts source from bracketed component name", () => {
      // #given: a message with component prefix
      const message = "[todo-enforcer] Task completed"

      // #when: extracting source
      const { source, cleanMessage } = extractSource(message)

      // #then: should extract component and clean message
      expect(source).toBe("todo-enforcer")
      expect(cleanMessage).toBe("Task completed")
    })

    test("returns undefined source for messages without brackets", () => {
      // #given: a message without component prefix
      const message = "Config loaded from path"

      // #when: extracting source
      const { source, cleanMessage } = extractSource(message)

      // #then: should return undefined source and original message
      expect(source).toBeUndefined()
      expect(cleanMessage).toBe("Config loaded from path")
    })
  })

  describe("extractJsonData", () => {
    test("extracts JSON object from end of message", () => {
      // #given: a message with JSON at the end
      const message = 'Config loaded {"key": "value"}'

      // #when: extracting JSON data
      const { message: cleanMsg, data } = extractJsonData(message)

      // #then: should extract JSON and clean message
      expect(cleanMsg).toBe("Config loaded")
      expect(data).toEqual({ key: "value" })
    })

    test("returns original message when no JSON present", () => {
      // #given: a message without JSON
      const message = "Simple log message"

      // #when: extracting JSON data
      const { message: cleanMsg, data } = extractJsonData(message)

      // #then: should return original message with undefined data
      expect(cleanMsg).toBe("Simple log message")
      expect(data).toBeUndefined()
    })

    test("returns original message when JSON is invalid", () => {
      // #given: a message with invalid JSON-like content
      const message = "Message with {invalid json"

      // #when: extracting JSON data
      const { message: cleanMsg, data } = extractJsonData(message)

      // #then: should return original message
      expect(cleanMsg).toBe("Message with {invalid json")
      expect(data).toBeUndefined()
    })
  })

  describe("parseLogLine", () => {
    test("parses a complete log line", () => {
      // #given: a valid log line
      const line =
        '[2025-12-31T11:16:46.279Z] [component] Message here {"data": 123}'

      // #when: parsing the line
      const entry = parseLogLine(line)

      // #then: should return a complete LogEntry
      expect(entry).not.toBeNull()
      expect(entry!.timestamp).toBeInstanceOf(Date)
      expect(entry!.source).toBe("component")
      expect(entry!.message).toBe("Message here")
      expect(entry!.data).toEqual({ data: 123 })
      expect(entry!.level).toBe("info")
    })

    test("parses a log line without JSON data", () => {
      // #given: a log line without JSON
      const line = "[2025-12-31T11:16:46.279Z] [component] Simple message"

      // #when: parsing the line
      const entry = parseLogLine(line)

      // #then: should return entry without data
      expect(entry).not.toBeNull()
      expect(entry!.message).toBe("Simple message")
      expect(entry!.data).toBeUndefined()
    })

    test("parses a log line without component prefix", () => {
      // #given: a log line without component
      const line = "[2025-12-31T11:16:46.279Z] Direct message"

      // #when: parsing the line
      const entry = parseLogLine(line)

      // #then: should return entry without source
      expect(entry).not.toBeNull()
      expect(entry!.source).toBeUndefined()
      expect(entry!.message).toBe("Direct message")
    })

    test("returns null for empty lines", () => {
      // #given: an empty line
      const line = ""

      // #when: parsing the line
      const entry = parseLogLine(line)

      // #then: should return null
      expect(entry).toBeNull()
    })

    test("returns null for malformed lines", () => {
      // #given: a line without timestamp
      const line = "This is not a valid log line"

      // #when: parsing the line
      const entry = parseLogLine(line)

      // #then: should return null
      expect(entry).toBeNull()
    })
  })

  describe("parseLogFile", () => {
    test("parses multiple log lines", () => {
      // #given: log file content with multiple lines
      const content = `[2025-12-31T11:16:46.279Z] [comp1] Message 1
[2025-12-31T11:16:47.279Z] [comp2] Message 2
[2025-12-31T11:16:48.279Z] [comp3] Message 3`

      // #when: parsing the file
      const entries = parseLogFile(content)

      // #then: should return all valid entries
      expect(entries).toHaveLength(3)
      expect(entries[0].source).toBe("comp1")
      expect(entries[1].source).toBe("comp2")
      expect(entries[2].source).toBe("comp3")
    })

    test("skips invalid lines", () => {
      // #given: content with some invalid lines
      const content = `[2025-12-31T11:16:46.279Z] Valid line
invalid line here
[2025-12-31T11:16:47.279Z] Another valid line`

      // #when: parsing the file
      const entries = parseLogFile(content)

      // #then: should only include valid entries
      expect(entries).toHaveLength(2)
    })

    test("handles empty content", () => {
      // #given: empty content
      const content = ""

      // #when: parsing the file
      const entries = parseLogFile(content)

      // #then: should return empty array
      expect(entries).toHaveLength(0)
    })
  })

  describe("filterByLevel", () => {
    test("returns all entries for 'all' level", () => {
      // #given: entries with mixed levels
      const entries: LogEntry[] = [
        { timestamp: new Date(), message: "info", level: "info" },
        { timestamp: new Date(), message: "warn", level: "warn" },
        { timestamp: new Date(), message: "error", level: "error" },
      ]

      // #when: filtering by 'all'
      const filtered = filterByLevel(entries, "all")

      // #then: should return all entries
      expect(filtered).toHaveLength(3)
    })

    test("filters to warn and above", () => {
      // #given: entries with mixed levels
      const entries: LogEntry[] = [
        { timestamp: new Date(), message: "info", level: "info" },
        { timestamp: new Date(), message: "warn", level: "warn" },
        { timestamp: new Date(), message: "error", level: "error" },
      ]

      // #when: filtering by 'warn'
      const filtered = filterByLevel(entries, "warn")

      // #then: should return warn and error only
      expect(filtered).toHaveLength(2)
      expect(filtered[0].level).toBe("warn")
      expect(filtered[1].level).toBe("error")
    })

    test("filters to errors only", () => {
      // #given: entries with mixed levels
      const entries: LogEntry[] = [
        { timestamp: new Date(), message: "info", level: "info" },
        { timestamp: new Date(), message: "warn", level: "warn" },
        { timestamp: new Date(), message: "error", level: "error" },
      ]

      // #when: filtering by 'error'
      const filtered = filterByLevel(entries, "error")

      // #then: should return only errors
      expect(filtered).toHaveLength(1)
      expect(filtered[0].level).toBe("error")
    })
  })

  describe("getLastNEntries", () => {
    test("returns last N entries", () => {
      // #given: an array of entries
      const entries: LogEntry[] = [
        { timestamp: new Date(), message: "1", level: "info" },
        { timestamp: new Date(), message: "2", level: "info" },
        { timestamp: new Date(), message: "3", level: "info" },
        { timestamp: new Date(), message: "4", level: "info" },
        { timestamp: new Date(), message: "5", level: "info" },
      ]

      // #when: getting last 3 entries
      const last = getLastNEntries(entries, 3)

      // #then: should return last 3
      expect(last).toHaveLength(3)
      expect(last[0].message).toBe("3")
      expect(last[1].message).toBe("4")
      expect(last[2].message).toBe("5")
    })

    test("returns all entries if N is larger than array", () => {
      // #given: a small array
      const entries: LogEntry[] = [
        { timestamp: new Date(), message: "1", level: "info" },
        { timestamp: new Date(), message: "2", level: "info" },
      ]

      // #when: requesting more entries than exist
      const last = getLastNEntries(entries, 10)

      // #then: should return all entries
      expect(last).toHaveLength(2)
    })

    test("returns empty array for N <= 0", () => {
      // #given: an array of entries
      const entries: LogEntry[] = [
        { timestamp: new Date(), message: "1", level: "info" },
      ]

      // #when: requesting 0 or negative entries
      const lastZero = getLastNEntries(entries, 0)
      const lastNeg = getLastNEntries(entries, -1)

      // #then: should return empty arrays
      expect(lastZero).toHaveLength(0)
      expect(lastNeg).toHaveLength(0)
    })
  })
})
