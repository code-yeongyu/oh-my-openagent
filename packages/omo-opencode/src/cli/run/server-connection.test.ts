import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { buildPaneAuthEnvironmentArgs } from "../../../../tmux-core/src/tmux-utils/pane-command"
import { createServerConnectionWithDeps, type ServerConnectionDeps, type ServerConnectionOptions } from "./server-connection"

const originalConsole = globalThis.console
type TestClient = { session: Record<string, unknown>, baseUrl?: string }

const mockServerClose = mock(() => {})
const mockCreateOpencode = mock(() =>
  Promise.resolve({
    client: { session: {} },
    server: { url: "http://127.0.0.1:4096", close: mockServerClose },
  })
)
const mockCreateOpencodeClient = mock((options?: { baseUrl?: string }) => ({
  session: {},
  baseUrl: options?.baseUrl,
}))
const mockIsPortAvailable = mock(() => Promise.resolve(true))
const mockGetAvailableServerPort = mock(() => Promise.resolve({ port: 4096, wasAutoSelected: false }))
const mockConsoleLog = mock(() => {})
const mockWithWorkingOpencodePath = mock((startServer: () => Promise<unknown>) => startServer())
const mockInjectServerAuthIntoClient = mock(() => {})

function createDeps(): ServerConnectionDeps<TestClient> {
  return {
    createOpencode: mockCreateOpencode,
    createOpencodeClient: mockCreateOpencodeClient,
    isPortAvailable: mockIsPortAvailable,
    getAvailableServerPort: mockGetAvailableServerPort,
    withWorkingOpencodePath: mockWithWorkingOpencodePath,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
  }
}

async function createServerConnection(options: ServerConnectionOptions) {
  return await createServerConnectionWithDeps(options, createDeps())
}

describe("createServerConnection", () => {
  beforeEach(() => {
    mockCreateOpencode.mockClear()
    mockCreateOpencodeClient.mockClear()
    mockIsPortAvailable.mockClear()
    mockGetAvailableServerPort.mockClear()
    mockServerClose.mockClear()
    mockConsoleLog.mockClear()
    mockWithWorkingOpencodePath.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    globalThis.console = { ...console, log: mockConsoleLog } as typeof console
  })

  afterEach(() => {
    globalThis.console = originalConsole
  })

  describe("#given no OPENCODE_SERVER_PASSWORD (omo#11367)", () => {
    const savedPassword = process.env.OPENCODE_SERVER_PASSWORD

    beforeEach(() => {
      delete process.env.OPENCODE_SERVER_PASSWORD
    })

    afterEach(() => {
      if (savedPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = savedPassword
    })

    it("#when omo run starts its own server #then the server is started with a generated password the client also uses", async () => {
      // given
      let passwordAtSpawn: string | undefined
      mockCreateOpencode.mockImplementationOnce(() => {
        passwordAtSpawn = process.env.OPENCODE_SERVER_PASSWORD
        return Promise.resolve({ client: { session: {} }, server: { url: "http://127.0.0.1:4096", close: mockServerClose } })
      })
      let passwordAtInject: string | undefined
      mockInjectServerAuthIntoClient.mockImplementationOnce(() => {
        passwordAtInject = process.env.OPENCODE_SERVER_PASSWORD
      })

      // when
      const result = await createServerConnection({ signal: new AbortController().signal })

      // then
      expect(passwordAtSpawn?.length ?? 0).toBeGreaterThanOrEqual(32)
      expect(passwordAtInject === passwordAtSpawn).toBe(true)
      const passwordFile = buildPaneAuthEnvironmentArgs()
        .find((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD_FILE="))?.slice("OPENCODE_SERVER_PASSWORD_FILE=".length)
      expect(passwordFile !== undefined).toBe(true)
      if (!passwordFile) throw new Error("missing private password file")
      if (process.platform !== "win32") {
        expect(statSync(passwordFile).mode & 0o777).toBe(0o600)
        expect(statSync(dirname(passwordFile)).mode & 0o777).toBe(0o700)
      }
      result.cleanup()
      expect(existsSync(passwordFile)).toBe(false)
      expect(existsSync(dirname(passwordFile))).toBe(false)
      expect(process.env.OPENCODE_SERVER_PASSWORD_FILE).toBeUndefined()
    })

    it("#when injecting auth into the client throws #then the server is closed and no generated password is left behind", async () => {
      // given
      let passwordFile: string | undefined
      mockInjectServerAuthIntoClient.mockImplementationOnce(() => {
        passwordFile = buildPaneAuthEnvironmentArgs()
          .find((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD_FILE="))?.slice("OPENCODE_SERVER_PASSWORD_FILE=".length)
        throw new Error("incompatible client")
      })
      mockServerClose.mockImplementationOnce(() => { throw new Error("close also failed") })

      // when
      const attempt = createServerConnection({ signal: new AbortController().signal })

      // then
      await expect(attempt).rejects.toThrow("incompatible client")
      expect(mockServerClose).toHaveBeenCalledTimes(1)
      expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
      expect(passwordFile !== undefined).toBe(true)
      if (!passwordFile) throw new Error("missing pending password file")
      expect(existsSync(dirname(passwordFile))).toBe(false)
    })

    it("#when closing the server throws during cleanup #then the generated password is still restored and the close error is rethrown", async () => {
      // given
      const result = await createServerConnection({ signal: new AbortController().signal })
      const passwordFile = buildPaneAuthEnvironmentArgs()
        .find((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD_FILE="))?.slice("OPENCODE_SERVER_PASSWORD_FILE=".length)
      expect(process.env.OPENCODE_SERVER_PASSWORD).toBeDefined()
      mockServerClose.mockImplementationOnce(() => {
        throw new Error("close failed")
      })

      // when
      const cleanup = () => result.cleanup()

      // then
      expect(cleanup).toThrow("close failed")
      expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
      expect(passwordFile !== undefined).toBe(true)
      if (!passwordFile) throw new Error("missing pending password file")
      expect(existsSync(dirname(passwordFile))).toBe(false)
    })

    it("#when the own server fails to start and omo attaches instead #then no generated password is left behind", async () => {
      // given
      mockIsPortAvailable.mockImplementationOnce(() => Promise.resolve(true)).mockImplementationOnce(() => Promise.resolve(false))
      mockCreateOpencode.mockImplementationOnce(() => Promise.reject(new Error("Failed to start server on port 4100")))

      // when
      const result = await createServerConnection({ port: 4100, signal: new AbortController().signal })

      // then
      expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:4100" })
      expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
      result.cleanup()
    })
  })

  it("#given a user-set OPENCODE_SERVER_PASSWORD #when omo run starts its own server #then that password is kept (omo#11367)", async () => {
    // given
    const savedPassword = process.env.OPENCODE_SERVER_PASSWORD
    process.env.OPENCODE_SERVER_PASSWORD = "user-chosen"
    let passwordAtSpawn: string | undefined
    mockCreateOpencode.mockImplementationOnce(() => {
      passwordAtSpawn = process.env.OPENCODE_SERVER_PASSWORD
      return Promise.resolve({ client: { session: {} }, server: { url: "http://127.0.0.1:4096", close: mockServerClose } })
    })

    try {
      // when
      const result = await createServerConnection({ signal: new AbortController().signal })

      // then
      expect(passwordAtSpawn).toBe("user-chosen")
      result.cleanup()
    } finally {
      if (savedPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = savedPassword
    }
  })

  it("attach mode injects auth only for loopback URLs", async () => {
    // given
    const signal = new AbortController().signal

    // when
    const localhostResult = await createServerConnection({ attach: "http://localhost:8080", signal })
    const loopbackResult = await createServerConnection({ attach: "http://127.0.0.1:8080", signal })
    const anyBindResult = await createServerConnection({ attach: "http://0.0.0.0:8080", signal })
    const remoteResult = await createServerConnection({ attach: "https://example.com", signal })

    // then
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://localhost:8080" })
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:8080" })
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://0.0.0.0:8080" })
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "https://example.com" })
    expect(mockInjectServerAuthIntoClient).toHaveBeenCalledTimes(3)
    expect(mockInjectServerAuthIntoClient).toHaveBeenNthCalledWith(1, localhostResult.client)
    expect(mockInjectServerAuthIntoClient).toHaveBeenNthCalledWith(2, loopbackResult.client)
    expect(mockInjectServerAuthIntoClient).toHaveBeenNthCalledWith(3, anyBindResult.client)
    expect(mockInjectServerAuthIntoClient).not.toHaveBeenCalledWith(remoteResult.client)
    expect(mockWithWorkingOpencodePath).not.toHaveBeenCalled()
    localhostResult.cleanup()
    loopbackResult.cleanup()
    anyBindResult.cleanup()
    remoteResult.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("attach mode skips auth injection for invalid attach URLs", async () => {
    // given
    const signal = new AbortController().signal
    const attachUrl = "not-a-url"

    // when
    const result = await createServerConnection({ attach: attachUrl, signal })

    // then
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: attachUrl })
    expect(mockInjectServerAuthIntoClient).not.toHaveBeenCalled()
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("attach mode returns client with no-op cleanup", async () => {
    // given
    const signal = new AbortController().signal
    const attachUrl = "http://localhost:8080"

    // when
    const result = await createServerConnection({ attach: attachUrl, signal })

    // then
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

  it("fresh server start injects auth into client", async () => {
    // given
    const signal = new AbortController().signal
    mockIsPortAvailable.mockResolvedValueOnce(true)

    // when
    const result = await createServerConnection({ port: 8080, signal })

    // then
    expect(mockInjectServerAuthIntoClient).toHaveBeenCalledTimes(1)
    expect(mockInjectServerAuthIntoClient).toHaveBeenCalledWith(result.client)
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalled()
  })
})
