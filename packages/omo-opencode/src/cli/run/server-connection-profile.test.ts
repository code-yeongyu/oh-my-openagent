import { describe, expect, it, mock } from "bun:test"
import { createServerConnectionWithDeps, type ServerConnectionDeps } from "./server-connection"

function fixture() {
  const close = mock(() => {})
  const createOpencode = mock(async () => ({ client: { owned: true }, server: { url: "http://127.0.0.1:4096", close } }))
  const createOpencodeClient = mock(() => ({ owned: false }))
  const isPortAvailable = mock(async () => true)
  const getAvailableServerPort = mock(async () => ({ port: 4096, wasAutoSelected: false }))
  const deps: ServerConnectionDeps<{ owned: boolean }> = {
    createOpencode, createOpencodeClient, isPortAvailable, getAvailableServerPort,
    injectServerAuthIntoClient: () => {},
    withWorkingOpencodePath: (start) => start(),
  }
  return { deps, createOpencode, createOpencodeClient, isPortAvailable, getAvailableServerPort, close }
}

describe("explicit run profile requires a new server", () => {
  it("refuses explicit attachment before connecting", async () => {
    // given
    const f = fixture()

    // when / then
    await expect(createServerConnectionWithDeps({ attach: "http://localhost:4096", requireNewServer: true, signal: new AbortController().signal }, f.deps))
      .rejects.toThrow("--profile requires a new server")
    expect(f.createOpencodeClient).not.toHaveBeenCalled()
    expect(f.createOpencode).not.toHaveBeenCalled()
  })

  it("refuses occupied explicit port attachment", async () => {
    // given
    const f = fixture()
    f.isPortAvailable.mockResolvedValueOnce(false)

    // when / then
    await expect(createServerConnectionWithDeps({ port: 4100, requireNewServer: true, signal: new AbortController().signal }, f.deps))
      .rejects.toThrow("--profile requires a new server")
    expect(f.createOpencodeClient).not.toHaveBeenCalled()
    expect(f.createOpencode).not.toHaveBeenCalled()
  })

  it("refuses attachment when an explicit port becomes occupied during startup", async () => {
    // given
    const f = fixture()
    f.isPortAvailable.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    f.createOpencode.mockRejectedValueOnce(new Error("Failed to start server on port 4100"))

    // when / then
    await expect(createServerConnectionWithDeps({ port: 4100, requireNewServer: true, signal: new AbortController().signal }, f.deps))
      .rejects.toThrow("--profile requires a new server")
    expect(f.createOpencodeClient).not.toHaveBeenCalled()
  })

  it("refuses exhausted-range fallback attachment", async () => {
    // given
    const f = fixture()
    f.getAvailableServerPort.mockRejectedValueOnce(new Error("No available port found in range 4096-4116"))
    f.isPortAvailable.mockResolvedValueOnce(false)

    // when / then
    await expect(createServerConnectionWithDeps({ requireNewServer: true, signal: new AbortController().signal }, f.deps))
      .rejects.toThrow("--profile requires a new server")
    expect(f.createOpencodeClient).not.toHaveBeenCalled()
    expect(f.createOpencode).not.toHaveBeenCalled()
  })

  it("still starts a new server on an automatically retried port", async () => {
    // given
    const f = fixture()
    f.getAvailableServerPort.mockResolvedValueOnce({ port: 4096, wasAutoSelected: false }).mockResolvedValueOnce({ port: 4097, wasAutoSelected: true })
    f.createOpencode.mockRejectedValueOnce(new Error("Failed to start server on port 4096"))

    // when
    const connection = await createServerConnectionWithDeps({ requireNewServer: true, signal: new AbortController().signal }, f.deps)
    connection.cleanup()

    // then
    expect(connection.client.owned).toBe(true)
    expect(f.createOpencodeClient).not.toHaveBeenCalled()
    expect(f.createOpencode).toHaveBeenCalledTimes(2)
    expect(f.close).toHaveBeenCalledTimes(1)
  })
})
