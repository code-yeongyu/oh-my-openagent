import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from "bun:test"

import * as originalSdk from "@opencode-ai/sdk"
import * as originalPortUtils from "../../shared/port-utils"
import * as originalBinaryResolver from "./opencode-binary-resolver"

const originalConsole = globalThis.console

const mockServerClose = mock(() => {})
const mockCreateOpencode = mock(() =>
  Promise.resolve({
    client: { session: {} },
    server: { url: "http://127.0.0.1:4096", close: mockServerClose },
  })
)
const mockCreateOpencodeClient = mock(() => ({ session: {} }))
const mockIsPortAvailable = mock(() => Promise.resolve(true))
const mockGetAvailableServerPort = mock(() => Promise.resolve({ port: 4096, wasAutoSelected: false }))
const mockConsoleLog = mock(() => {})
const mockWithWorkingOpencodePath = mock((startServer: () => Promise<unknown>) => startServer())

mock.module("@opencode-ai/sdk", () => ({
  createOpencode: mockCreateOpencode,
  createOpencodeClient: mockCreateOpencodeClient,
}))

mock.module("../../shared/port-utils", () => ({
  isPortAvailable: mockIsPortAvailable,
  getAvailableServerPort: mockGetAvailableServerPort,
  DEFAULT_SERVER_PORT: 4096,
}))

mock.module("./opencode-binary-resolver", () => ({
  withWorkingOpencodePath: mockWithWorkingOpencodePath,
}))

afterAll(() => {
  mock.module("@opencode-ai/sdk", () => originalSdk)
  mock.module("../../shared/port-utils", () => originalPortUtils)
  mock.module("./opencode-binary-resolver", () => originalBinaryResolver)
})

const { createServerConnection } = await import("./server-connection")

describe("createServerConnection", () => {
  beforeEach(() => {
    mockCreateOpencode.mockClear()
    mockCreateOpencodeClient.mockClear()
    mockIsPortAvailable.mockClear()
    mockGetAvailableServerPort.mockClear()
    mockServerClose.mockClear()
    mockConsoleLog.mockClear()
    mockWithWorkingOpencodePath.mockClear()
    globalThis.console = { ...console, log: mockConsoleLog } as typeof console
  })

  afterEach(() => {
    globalThis.console = originalConsole
  })

  it("attach mode returns client with no-op cleanup", async () => {
    // given
    const signal = new AbortController().signal
    const attachUrl = "http://localhost:8080"

    // when
    const result = await createServerConnection({ attach: attachUrl, signal })

    // then
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: attachUrl })
    expect(mockWithWorkingOpencodePath).not.toHaveBeenCalled()
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("explicit port starts server when port is available", async () => {
    // given
    const signal = new AbortController().signal
    const port = 8080
    mockIsPortAvailable.mockResolvedValueOnce(true)

    // when
    const result = await createServerConnection({ port, signal })

    // then
    expect(mockIsPortAvailable).toHaveBeenCalledWith(8080, "127.0.0.1")
    expect(mockWithWorkingOpencodePath).toHaveBeenCalledTimes(1)
    expect(mockCreateOpencode).toHaveBeenCalledWith({ signal, port: 8080, hostname: "127.0.0.1" })
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled()
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalled()
  })

  it("explicit port attaches when start fails because port became occupied", async () => {
    // given
    const signal = new AbortController().signal
    const port = 8080
    mockIsPortAvailable.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mockCreateOpencode.mockRejectedValueOnce(new Error("Failed to start server on port 8080"))

    // when
    const result = await createServerConnection({ port, signal })

    // then
    expect(mockIsPortAvailable).toHaveBeenNthCalledWith(1, 8080, "127.0.0.1")
    expect(mockIsPortAvailable).toHaveBeenNthCalledWith(2, 8080, "127.0.0.1")
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:8080" })
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("explicit port attaches when port is occupied", async () => {
    // given
    const signal = new AbortController().signal
    const port = 8080
    mockIsPortAvailable.mockResolvedValueOnce(false)

    // when
    const result = await createServerConnection({ port, signal })

    // then
    expect(mockIsPortAvailable).toHaveBeenCalledWith(8080, "127.0.0.1")
    expect(mockCreateOpencode).not.toHaveBeenCalled()
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:8080" })
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("auto mode uses getAvailableServerPort", async () => {
    // given
    const signal = new AbortController().signal
    mockGetAvailableServerPort.mockResolvedValueOnce({ port: 4100, wasAutoSelected: true })

    // when
    const result = await createServerConnection({ signal })

    // then
    expect(mockGetAvailableServerPort).toHaveBeenCalledWith(4096, "127.0.0.1")
    expect(mockWithWorkingOpencodePath).toHaveBeenCalledTimes(1)
    expect(mockCreateOpencode).toHaveBeenCalledWith({ signal, port: 4100, hostname: "127.0.0.1" })
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled()
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalled()
  })

  it("auto mode retries on next port when initial start fails", async () => {
    // given
    const signal = new AbortController().signal
    mockGetAvailableServerPort
      .mockResolvedValueOnce({ port: 4096, wasAutoSelected: false })
      .mockResolvedValueOnce({ port: 4097, wasAutoSelected: true })

    mockCreateOpencode
      .mockRejectedValueOnce(new Error("Failed to start server on port 4096"))
      .mockResolvedValueOnce({
        client: { session: {} },
        server: { url: "http://127.0.0.1:4097", close: mockServerClose },
      })

    // when
    const result = await createServerConnection({ signal })

    // then
    expect(mockGetAvailableServerPort).toHaveBeenNthCalledWith(1, 4096, "127.0.0.1")
    expect(mockGetAvailableServerPort).toHaveBeenNthCalledWith(2, 4097, "127.0.0.1")
    expect(mockCreateOpencode).toHaveBeenNthCalledWith(1, { signal, port: 4096, hostname: "127.0.0.1" })
    expect(mockCreateOpencode).toHaveBeenNthCalledWith(2, { signal, port: 4097, hostname: "127.0.0.1" })
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalledTimes(1)
  })

  it("auto mode attaches to default server when port range is exhausted", async () => {
    // given
    const signal = new AbortController().signal
    mockGetAvailableServerPort.mockRejectedValueOnce(
      new Error("No available port found in range 4097-4116"),
    )
    mockIsPortAvailable.mockResolvedValueOnce(false)

    // when
    const result = await createServerConnection({ signal })

    // then
    expect(mockGetAvailableServerPort).toHaveBeenCalledWith(4096, "127.0.0.1")
    expect(mockIsPortAvailable).toHaveBeenCalledWith(4096, "127.0.0.1")
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4096",
    })
    expect(mockCreateOpencode).not.toHaveBeenCalled()
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("invalid port throws error", async () => {
    // given
    const signal = new AbortController().signal

    // when & then
    await expect(createServerConnection({ port: 0, signal })).rejects.toThrow("Port must be between 1 and 65535")
    await expect(createServerConnection({ port: -1, signal })).rejects.toThrow("Port must be between 1 and 65535")
    await expect(createServerConnection({ port: 99999, signal })).rejects.toThrow("Port must be between 1 and 65535")
  })

  it("cleanup calls server.close for owned server", async () => {
    // given
    const signal = new AbortController().signal
    mockIsPortAvailable.mockResolvedValueOnce(true)

    // when
    const result = await createServerConnection({ port: 8080, signal })
    result.cleanup()

    // then
    expect(mockServerClose).toHaveBeenCalledTimes(1)
  })

  it("cleanup is no-op for attached server", async () => {
    // given
    const signal = new AbortController().signal
    const attachUrl = "http://localhost:8080"

    // when
    const result = await createServerConnection({ attach: attachUrl, signal })
    result.cleanup()

    // then
    expect(mockServerClose).not.toHaveBeenCalled()
  })
})
