import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const findAgentsMdUpMock = mock((_: { startDir: string; rootDir: string }) => [] as string[])
const resolveFilePathMock = mock((_: string, path: string) => path)
const loadInjectedPathsMock = mock((_: string) => new Set<string>())
const saveInjectedPathsMock = mock((_: string, __: Set<string>) => {})

describe("processFilePathForAgentsInjection", () => {
  let testRoot = ""

  beforeEach(() => {
    findAgentsMdUpMock.mockClear()
    resolveFilePathMock.mockClear()
    loadInjectedPathsMock.mockClear()
    saveInjectedPathsMock.mockClear()

    testRoot = join(
      tmpdir(),
      `directory-agents-injector-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    mkdirSync(testRoot, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    rmSync(testRoot, { recursive: true, force: true })
  })

  it("does not save when all discovered paths are already cached", async () => {
    //#given
    const sessionID = "session-1"
    const repoRoot = join(testRoot, "repo")
    const agentsPath = join(repoRoot, "src", "AGENTS.md")
    const cachedDirectory = join(repoRoot, "src")
    mkdirSync(join(repoRoot, "src"), { recursive: true })
    writeFileSync(agentsPath, "# AGENTS")

    loadInjectedPathsMock.mockReturnValueOnce(new Set([cachedDirectory]))
    findAgentsMdUpMock.mockReturnValueOnce([agentsPath])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    mock.module("./finder", () => ({
      findAgentsMdUp: findAgentsMdUpMock,
      resolveFilePath: resolveFilePathMock,
    }))
    mock.module("./storage", () => ({
      loadInjectedPaths: loadInjectedPathsMock,
      saveInjectedPaths: saveInjectedPathsMock,
    }))

    const { processFilePathForAgentsInjection } = await import("./injector")

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: repoRoot } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: join(repoRoot, "src", "file.ts"),
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    expect(saveInjectedPathsMock).not.toHaveBeenCalled()
  })

  it("saves when a new path is injected", async () => {
    //#given
    const sessionID = "session-2"
    const repoRoot = join(testRoot, "repo")
    const agentsPath = join(repoRoot, "src", "AGENTS.md")
    const injectedDirectory = join(repoRoot, "src")
    mkdirSync(join(repoRoot, "src"), { recursive: true })
    writeFileSync(agentsPath, "# AGENTS")

    loadInjectedPathsMock.mockReturnValueOnce(new Set())
    findAgentsMdUpMock.mockReturnValueOnce([agentsPath])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    mock.module("./finder", () => ({
      findAgentsMdUp: findAgentsMdUpMock,
      resolveFilePath: resolveFilePathMock,
    }))
    mock.module("./storage", () => ({
      loadInjectedPaths: loadInjectedPathsMock,
      saveInjectedPaths: saveInjectedPathsMock,
    }))

    const { processFilePathForAgentsInjection } = await import("./injector")

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: repoRoot } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: join(repoRoot, "src", "file.ts"),
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    expect(saveInjectedPathsMock).toHaveBeenCalledTimes(1)
    const saveCall = saveInjectedPathsMock.mock.calls[0]
    expect(saveCall[0]).toBe(sessionID)
    expect((saveCall[1] as Set<string>).has(injectedDirectory)).toBe(true)
  })

  it("saves once when cached and new paths are mixed", async () => {
    //#given
    const sessionID = "session-3"
    const repoRoot = join(testRoot, "repo")
    const cachedAgentsPath = join(repoRoot, "already-cached", "AGENTS.md")
    const newAgentsPath = join(repoRoot, "new-dir", "AGENTS.md")
    mkdirSync(join(repoRoot, "already-cached"), { recursive: true })
    mkdirSync(join(repoRoot, "new-dir"), { recursive: true })
    writeFileSync(cachedAgentsPath, "# AGENTS")
    writeFileSync(newAgentsPath, "# AGENTS")

    loadInjectedPathsMock.mockReturnValueOnce(new Set([join(repoRoot, "already-cached")]))
    findAgentsMdUpMock.mockReturnValueOnce([cachedAgentsPath, newAgentsPath])

    const truncator = {
      truncate: mock(async () => ({ result: "trimmed", truncated: false })),
    }

    mock.module("./finder", () => ({
      findAgentsMdUp: findAgentsMdUpMock,
      resolveFilePath: resolveFilePathMock,
    }))
    mock.module("./storage", () => ({
      loadInjectedPaths: loadInjectedPathsMock,
      saveInjectedPaths: saveInjectedPathsMock,
    }))

    const { processFilePathForAgentsInjection } = await import("./injector")

    //#when
    await processFilePathForAgentsInjection({
      ctx: { directory: repoRoot } as never,
      truncator: truncator as never,
      sessionCaches: new Map(),
      filePath: join(repoRoot, "new-dir", "file.ts"),
      sessionID,
      output: { title: "Result", output: "", metadata: {} },
    })

    //#then
    expect(saveInjectedPathsMock).toHaveBeenCalledTimes(1)
    const saveCall = saveInjectedPathsMock.mock.calls[0]
    expect((saveCall[1] as Set<string>).has(join(repoRoot, "new-dir"))).toBe(true)
  })
})
