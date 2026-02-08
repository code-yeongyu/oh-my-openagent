import { describe, it, expect, beforeEach } from "bun:test"
import type { RunResult } from "./types"
import { createJsonOutputManager } from "./json-output"

interface MockWriteStream {
  write: (chunk: string) => boolean
  writes: string[]
}

function createMockWriteStream(): MockWriteStream {
  const stream: MockWriteStream = {
    writes: [],
    write: function (this: MockWriteStream, chunk: string): boolean {
      this.writes.push(chunk)
      return true
    },
  }
  return stream
}

describe("createJsonOutputManager", () => {
  let mockStdout: MockWriteStream
  let mockStderr: MockWriteStream

  beforeEach(() => {
    mockStdout = createMockWriteStream()
    mockStderr = createMockWriteStream()
  })

  describe("redirectToStderr", () => {
    it("causes stdout writes to go to stderr", () => {
      // given
      const manager = createJsonOutputManager({
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stderr: mockStderr as unknown as NodeJS.WriteStream,
      })
      manager.redirectToStderr()

      // when
      mockStdout.write("test message")

      // then
      expect(mockStdout.writes).toHaveLength(0)
      expect(mockStderr.writes).toEqual(["test message"])
    })
  })

  describe("restore", () => {
    it("reverses the redirect", () => {
      // given
      const manager = createJsonOutputManager({
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stderr: mockStderr as unknown as NodeJS.WriteStream,
      })
      manager.redirectToStderr()

      // when
      manager.restore()
      mockStdout.write("restored message")

      // then
      expect(mockStdout.writes).toEqual(["restored message"])
      expect(mockStderr.writes).toHaveLength(0)
    })
  })

  describe("emitResult", () => {
    it("writes valid JSON to stdout", () => {
      // given
      const result: RunResult = {
        sessionId: "test-session",
        success: true,
        durationMs: 1234,
        messageCount: 42,
        summary: "Test summary",
      }
      const manager = createJsonOutputManager({
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stderr: mockStderr as unknown as NodeJS.WriteStream,
      })

      // when
      manager.emitResult(result)

      // then
      expect(mockStdout.writes).toHaveLength(1)
      const emitted = mockStdout.writes[0]!
      expect(() => JSON.parse(emitted)).not.toThrow()
    })

    it("output matches RunResult schema", () => {
      // given
      const result: RunResult = {
        sessionId: "test-session",
        success: true,
        durationMs: 1234,
        messageCount: 42,
        summary: "Test summary",
      }
      const manager = createJsonOutputManager({
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stderr: mockStderr as unknown as NodeJS.WriteStream,
      })

      // when
      manager.emitResult(result)

      // then
      const emitted = mockStdout.writes[0]!
      const parsed = JSON.parse(emitted) as RunResult
      expect(parsed).toEqual(result)
      expect(parsed.sessionId).toBe("test-session")
      expect(parsed.success).toBe(true)
      expect(parsed.durationMs).toBe(1234)
      expect(parsed.messageCount).toBe(42)
      expect(parsed.summary).toBe("Test summary")
    })

    it("restores stdout even if redirect was active", () => {
      // given
      const result: RunResult = {
        sessionId: "test-session",
        success: true,
        durationMs: 100,
        messageCount: 1,
        summary: "Test",
      }
      const manager = createJsonOutputManager({
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stderr: mockStderr as unknown as NodeJS.WriteStream,
      })
      manager.redirectToStderr()

      // when
      manager.emitResult(result)

      // then
      expect(mockStdout.writes).toHaveLength(1)
      expect(mockStdout.writes[0]!).toBe(JSON.stringify(result) + "\n")

      mockStdout.write("after emit")
      expect(mockStdout.writes).toHaveLength(2)
      expect(mockStderr.writes).toHaveLength(0)
    })
  })

  describe("multiple redirects and restores", () => {
    it("work correctly", () => {
      // given
      const manager = createJsonOutputManager({
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stderr: mockStderr as unknown as NodeJS.WriteStream,
      })

      // when
      manager.redirectToStderr()
      mockStdout.write("first redirect")

      manager.redirectToStderr()
      mockStdout.write("second redirect")

      manager.restore()
      mockStdout.write("after restore")

      // then
      expect(mockStdout.writes).toEqual(["after restore"])
      expect(mockStderr.writes).toEqual(["first redirect", "second redirect"])
    })
  })
})
