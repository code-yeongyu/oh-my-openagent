import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test"
import type { RunResult } from "./types"
import { createJsonOutputManager } from "./json-output"
import { resolveSession } from "./session-resolver"
import { executeOnCompleteHook } from "./on-complete-hook"
import type { OpencodeClient } from "./types"

const mockServerClose = mock(() => {})
const mockCreateOpencode = mock(() =>
  Promise.resolve({
    client: { session: {} },
    server: { url: "http://127.0.0.1:9999", close: mockServerClose },
  })
)
const mockCreateOpencodeClient = mock(() => ({ session: {} }))
const mockIsPortAvailable = mock(() => Promise.resolve(true))
const mockGetAvailableServerPort = mock(() => Promise.resolve({ port: 9999, wasAutoSelected: false }))

mock.module("@opencode-ai/sdk", () => ({
  createOpencode: mockCreateOpencode,
  createOpencodeClient: mockCreateOpencodeClient,
}))

mock.module("../../shared/port-utils", () => ({
  isPortAvailable: mockIsPortAvailable,
  getAvailableServerPort: mockGetAvailableServerPort,
  DEFAULT_SERVER_PORT: 4096,
}))

const { createServerConnection } = await import("./server-connection")

interface MockWriteStream {
  write: (chunk: string) => boolean
  writes: string[]
}

function createMockWriteStream(): MockWriteStream {
  const writes: string[] = []
  return {
    writes,
    write: function (this: MockWriteStream, chunk: string): boolean {
      this.writes.push(chunk)
      return true
    },
  }
}

const createMockClient = (
  getResult?: { error?: unknown; data?: { id: string } }
): OpencodeClient => ({
  session: {
    get: mock((opts: { path: { id: string } }) =>
      Promise.resolve(getResult ?? { data: { id: opts.path.id } })
    ),
    create: mock(() => Promise.resolve({ data: { id: "new-session-id" } })),
  },
} as unknown as OpencodeClient)

describe("integration: --json mode", () => {
  it("emits valid RunResult JSON to stdout", () => {
    // given
    const mockStdout = createMockWriteStream()
    const mockStderr = createMockWriteStream()
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
    const parsed = JSON.parse(emitted) as RunResult
    expect(parsed.sessionId).toBe("test-session")
    expect(parsed.success).toBe(true)
    expect(parsed.durationMs).toBe(1234)
    expect(parsed.messageCount).toBe(42)
    expect(parsed.summary).toBe("Test summary")
  })

  it("redirects stdout to stderr when active", () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const mockStdout = createMockWriteStream()
    const mockStderr = createMockWriteStream()
    const manager = createJsonOutputManager({
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stderr: mockStderr as unknown as NodeJS.WriteStream,
    })
    manager.redirectToStderr()

    // when
    mockStdout.write("should go to stderr")

    // then
    expect(mockStdout.writes).toHaveLength(0)
    expect(mockStderr.writes).toEqual(["should go to stderr"])
  })
})

describe("integration: --session-id", () => {
  beforeEach(() => {
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
  })

  it("resolves provided session ID without creating new session", async () => {
    // given
    const sessionId = "existing-session-id"
    const mockClient = createMockClient({ data: { id: sessionId } })

    // when
    const result = await resolveSession({ client: mockClient, sessionId })

    // then
    expect(result).toBe(sessionId)
    expect(mockClient.session.get).toHaveBeenCalledWith({ path: { id: sessionId } })
    expect(mockClient.session.create).not.toHaveBeenCalled()
  })

  it("throws when session does not exist", async () => {
    // given
    const sessionId = "non-existent-session-id"
    const mockClient = createMockClient({ error: { message: "Session not found" } })

    // when
    const result = resolveSession({ client: mockClient, sessionId })

    // then
    await expect(result).rejects.toThrow(`Session not found: ${sessionId}`)
    expect(mockClient.session.get).toHaveBeenCalledWith({ path: { id: sessionId } })
    expect(mockClient.session.create).not.toHaveBeenCalled()
  })
})

describe("integration: --on-complete", () => {
  let spawnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spyOn(console, "error").mockImplementation(() => {})
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
      exitCode: 0,
    } as unknown as ReturnType<typeof Bun.spawn>)
  })

  afterEach(() => {
    spawnSpy.mockRestore()
  })

  it("passes all 4 env vars as strings to spawned process", async () => {
    // given
    spawnSpy.mockClear()

    // when
    await executeOnCompleteHook({
      command: "echo test",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const [_, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>
    expect(options?.env?.SESSION_ID).toBe("session-123")
    expect(options?.env?.EXIT_CODE).toBe("0")
    expect(options?.env?.DURATION_MS).toBe("5000")
    expect(options?.env?.MESSAGE_COUNT).toBe("10")
    expect(options?.env?.SESSION_ID).toBeTypeOf("string")
    expect(options?.env?.EXIT_CODE).toBeTypeOf("string")
    expect(options?.env?.DURATION_MS).toBeTypeOf("string")
    expect(options?.env?.MESSAGE_COUNT).toBeTypeOf("string")
  })
})

describe("integration: option combinations", () => {
  let mockStdout: MockWriteStream
  let mockStderr: MockWriteStream
  let spawnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    mockStdout = createMockWriteStream()
    mockStderr = createMockWriteStream()
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
      exitCode: 0,
    } as unknown as ReturnType<typeof Bun.spawn>)
  })

  afterEach(() => {
    spawnSpy?.mockRestore?.()
  })

  it("json output and on-complete hook can both execute", async () => {
    // given - json manager active + on-complete hook ready
    const result: RunResult = {
      sessionId: "session-123",
      success: true,
      durationMs: 5000,
      messageCount: 10,
      summary: "Test completed",
    }
    const jsonManager = createJsonOutputManager({
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stderr: mockStderr as unknown as NodeJS.WriteStream,
    })
    jsonManager.redirectToStderr()
    spawnSpy.mockClear()

    // when - both are invoked sequentially (as runner would)
    jsonManager.emitResult(result)
    await executeOnCompleteHook({
      command: "echo done",
      sessionId: result.sessionId,
      exitCode: result.success ? 0 : 1,
      durationMs: result.durationMs,
      messageCount: result.messageCount,
    })

    // then - json emits result AND on-complete hook runs
    expect(mockStdout.writes).toHaveLength(1)
    const emitted = mockStdout.writes[0]!
    expect(() => JSON.parse(emitted)).not.toThrow()
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const [args] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>
    expect(args).toEqual(["sh", "-c", "echo done"])
    const [_, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>
    expect(options?.env?.SESSION_ID).toBe("session-123")
    expect(options?.env?.EXIT_CODE).toBe("0")
    expect(options?.env?.DURATION_MS).toBe("5000")
    expect(options?.env?.MESSAGE_COUNT).toBe("10")
  })
})

describe("integration: server connection", () => {
  let consoleSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {})
    mockCreateOpencode.mockClear()
    mockCreateOpencodeClient.mockClear()
    mockServerClose.mockClear()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it("attach mode creates client with no-op cleanup", async () => {
    // given
    const signal = new AbortController().signal
    const attachUrl = "http://localhost:8080"

    // when
    const result = await createServerConnection({ attach: attachUrl, signal })

    // then
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: attachUrl })
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("port with available port starts server", async () => {
    // given
    const signal = new AbortController().signal
    const port = 9999

    // when
    const result = await createServerConnection({ port, signal })

    // then
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    expect(mockCreateOpencode).toHaveBeenCalled()
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalled()
  })
})
