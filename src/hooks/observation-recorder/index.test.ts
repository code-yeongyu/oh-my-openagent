import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test"
import * as fs from "fs"

// Spy on fs functions - scoped mocks that can be restored
const mockExistsSync = spyOn(fs, "existsSync")
const mockMkdirSync = spyOn(fs, "mkdirSync")
const mockAppendFileSync = spyOn(fs, "appendFileSync")
const mockStatSync = spyOn(fs, "statSync")
const mockRenameSync = spyOn(fs, "renameSync")
const mockReadFileSync = spyOn(fs, "readFileSync")

// Mock process.kill
const mockKill = spyOn(process, "kill").mockImplementation(() => true)

const { createObservationRecorderHook } = await import("./index")

describe("observation-recorder hook", () => {
  let consoleWarnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {})
    mockExistsSync.mockClear()
    mockMkdirSync.mockClear()
    mockAppendFileSync.mockClear()
    mockStatSync.mockClear()
    mockRenameSync.mockClear()
    mockReadFileSync.mockClear()
    mockKill.mockClear()
    
    // Default: directory doesn't exist, no disabled flag
    mockExistsSync.mockImplementation((path?: fs.PathLike) => {
      const pathStr = String(path ?? "")
      if (pathStr.endsWith("homunculus")) return false
      if (pathStr.endsWith("disabled")) return false
      if (pathStr.endsWith("observations.jsonl")) return false
      if (pathStr.endsWith(".observer.pid")) return false
      return false
    })
    mockMkdirSync.mockImplementation((() => undefined) as unknown as typeof fs.mkdirSync)
    mockAppendFileSync.mockImplementation((() => undefined) as unknown as typeof fs.appendFileSync)
    mockStatSync.mockImplementation((() => ({ size: 0 })) as unknown as typeof fs.statSync)
    mockRenameSync.mockImplementation((() => undefined) as unknown as typeof fs.renameSync)
    mockReadFileSync.mockImplementation((() => "") as unknown as typeof fs.readFileSync)
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  afterAll(() => {
    // Restore all fs spies to prevent leakage to other test files
    mockExistsSync.mockRestore()
    mockMkdirSync.mockRestore()
    mockAppendFileSync.mockRestore()
    mockStatSync.mockRestore()
    mockRenameSync.mockRestore()
    mockReadFileSync.mockRestore()
    mockKill.mockRestore()
  })

  it("should return an object with before and after handlers", () => {
    const hook = createObservationRecorderHook()
    expect("tool.execute.before" in hook).toBe(true)
    expect("tool.execute.after" in hook).toBe(true)
  })

  it("should record tool_start observation", async () => {
    const hook = createObservationRecorderHook()
    await hook["tool.execute.before"]({
      tool: "Read",
      sessionID: "test-session",
      callID: "call-1",
      input: { path: "test.txt" }
    })

    expect(mockAppendFileSync).toHaveBeenCalled()
    const writeCall = mockAppendFileSync.mock.calls[0] as unknown as [string, string]
    const written = JSON.parse(writeCall[1].trim())
    expect(written.tool).toBe("Read")
    expect(written.event).toBe("tool_start")
    expect(written.input).toBe(JSON.stringify({ path: "test.txt" }))
  })

  it("should record tool_complete observation", async () => {
    const hook = createObservationRecorderHook()
    await hook["tool.execute.after"](
      { tool: "Read", sessionID: "test-session", callID: "call-1" },
      { title: "File Read", output: "content", metadata: {} }
    )

    expect(mockAppendFileSync).toHaveBeenCalled()
    const writeCall = mockAppendFileSync.mock.calls[0] as unknown as [string, string]
    const written = JSON.parse(writeCall[1].trim())
    expect(written.tool).toBe("Read")
    expect(written.event).toBe("tool_complete")
    expect(written.output).toBe("content")
  })

  it("should signal observer if PID file exists", async () => {
    mockExistsSync.mockImplementation((path?: fs.PathLike) => {
      const pathStr = String(path ?? "")
      if (pathStr.endsWith("disabled")) return false
      if (pathStr.endsWith(".observer.pid")) return true
      return true // other paths (config dir, etc)
    })
    mockReadFileSync.mockReturnValue("12345")

    const hook = createObservationRecorderHook()
    await hook["tool.execute.before"]({
      tool: "Read",
      sessionID: "s1",
      callID: "c1",
      input: {}
    })

    expect(mockKill).toHaveBeenCalledWith(12345, "SIGUSR1")
  })

  it("should skip if disabled flag exists", async () => {
    mockExistsSync.mockImplementation((path?: fs.PathLike) => {
      const pathStr = String(path ?? "")
      if (pathStr.endsWith("disabled")) return true
      return true // directory exists
    })

    const hook = createObservationRecorderHook()
    await hook["tool.execute.after"](
      { tool: "Write", sessionID: "s1", callID: "c1" },
      { title: "T", output: "O", metadata: {} }
    )

    expect(mockAppendFileSync).not.toHaveBeenCalled()
  })

  it("should archive file when too large", async () => {
    mockExistsSync.mockImplementation((path?: fs.PathLike) => {
      const pathStr = String(path ?? "")
      if (pathStr.endsWith("disabled")) return false
      return true // directory and file exist
    })
    mockStatSync.mockReturnValue({ size: 15 * 1024 * 1024 } as fs.Stats) // 15MB > 10MB

    const hook = createObservationRecorderHook()
    await hook["tool.execute.after"](
      { tool: "Edit", sessionID: "s2", callID: "c2" },
      { title: "T", output: "O", metadata: {} }
    )

    expect(mockRenameSync).toHaveBeenCalled()
    expect(mockAppendFileSync).toHaveBeenCalled()
  })

  it("should handle errors gracefully", async () => {
    mockAppendFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied")
    })

    const hook = createObservationRecorderHook()
    await expect(
      hook["tool.execute.after"](
        { tool: "Bash", sessionID: "s3", callID: "c3" },
        { title: "T", output: "O", metadata: {} }
      )
    ).resolves.toBeUndefined()

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to record observation")
    )
  })
})
