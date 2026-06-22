import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"
import * as realFs from "node:fs"
import * as realFsPromises from "node:fs/promises"

// Capture real readFile via require before mock.module replaces it
// (mirrors the original readFileSync capture pattern)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realReadFile: typeof realFsPromises.readFile = require("node:fs/promises").readFile

// Capture real readFileSync to verify the refactor is not silently re-introduced
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realReadFileSync: typeof realFs.readFileSync = require("node:fs").readFileSync

const readFileMock = mock(async (path: string, encoding: string) => {
  if (typeof path === "string" && path.endsWith("AGENTS.md")) return "# AGENTS"
  return realReadFile(path, encoding as BufferEncoding)
})
const readFileSyncMock = mock((path: string, encoding: string) => {
  if (typeof path === "string" && path.endsWith("AGENTS.md")) return "# AGENTS"
  return realReadFileSync(path, encoding as BufferEncoding)
})
const findAgentsMdUpMock = mock((_: { startDir: string; rootDir: string }) => [] as string[])
const resolveFilePathMock = mock((_: string, path: string) => path)
const loadInjectedPathsMock = mock((_: string) => new Set<string>())
const saveInjectedPathsMock = mock((_: string, __: Set<string>) => {})

mock.module("node:fs/promises", () => ({
  ...realFsPromises,
  readFile: readFileMock,
}))

mock.module("node:fs", () => ({
  ...realFs,
  readFileSync: readFileSyncMock,
}))

mock.module("./finder", () => ({
  findAgentsMdUp: findAgentsMdUpMock,
  resolveFilePath: resolveFilePathMock,
}))

mock.module("./storage", () => ({
  loadInjectedPaths: loadInjectedPathsMock,
  saveInjectedPaths: saveInjectedPathsMock,
}))

const { processFilePathForAgentsInjection } = await import("./injector")

afterAll(() => {
  mock.module("node:fs/promises", () => realFsPromises)
  mock.module("node:fs", () => realFs)
})

describe("processFilePathForAgentsInjection", () => {
  beforeEach(() => {
    readFileMock.mockClear()
    readFileSyncMock.mockClear()
    findAgentsMdUpMock.mockClear()
    resolveFilePathMock.mockClear()
    loadInjectedPathsMock.mockClear()
    saveInjectedPathsMock.mockClear()
  })

  it("does not save when all discovered paths are already cached", async () => {
    //#given
    const sessionID = "session-1"
    const cachedDirectory = "/repo/src"
    loadInjectedPathsMock.mockReturnValueOnce(new Set([cachedDirectory]))
    findAgentsMdUpMock.mockReturnValueOnce(["/repo/src/AGENTS.md"])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: "/repo" } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: "/repo/src/file.ts",
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    expect(saveInjectedPathsMock).not.toHaveBeenCalled()
  })

  it("saves when a new path is injected", async () => {
    //#given
    const sessionID = "session-2"
    loadInjectedPathsMock.mockReturnValueOnce(new Set())
    findAgentsMdUpMock.mockReturnValueOnce(["/repo/src/AGENTS.md"])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: "/repo" } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: "/repo/src/file.ts",
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    expect(saveInjectedPathsMock).toHaveBeenCalledTimes(1)
    const saveCall = saveInjectedPathsMock.mock.calls[0]
    expect(saveCall[0]).toBe(sessionID)
    expect((saveCall[1] as Set<string>).has("/repo/src")).toBe(true)
  })

  it("saves once when cached and new paths are mixed", async () => {
    //#given
    const sessionID = "session-3"
    loadInjectedPathsMock.mockReturnValueOnce(new Set(["/repo/already-cached"]))
    findAgentsMdUpMock.mockReturnValueOnce([
      "/repo/already-cached/AGENTS.md",
      "/repo/new-dir/AGENTS.md",
    ])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: "/repo" } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: "/repo/new-dir/file.ts",
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    expect(saveInjectedPathsMock).toHaveBeenCalledTimes(1)
    const saveCall = saveInjectedPathsMock.mock.calls[0]
    expect((saveCall[1] as Set<string>).has("/repo/new-dir")).toBe(true)
  })

  it("uses fs.promises.readFile not readFileSync", async () => {
    //#given
    const sessionID = "session-4"
    loadInjectedPathsMock.mockReturnValueOnce(new Set())
    findAgentsMdUpMock.mockReturnValueOnce(["/repo/src/AGENTS.md"])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: "/repo" } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: "/repo/src/file.ts",
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    // The injector must call the async readFile from node:fs/promises
    expect(readFileMock).toHaveBeenCalledTimes(1)
    expect(readFileMock.mock.calls[0]?.[0]).toBe("/repo/src/AGENTS.md")
    expect(readFileMock.mock.calls[0]?.[1]).toBe("utf-8")
    // And it must NOT have fallen back to the blocking sync readFileSync
    expect(readFileSyncMock).not.toHaveBeenCalled()
  })
})
