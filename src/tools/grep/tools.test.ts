import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"

const projectDir = "/private/tmp/work-3003"

const mockCtx = { directory: projectDir } as PluginInput

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("grep tools", () => {
  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    mock.restore()
  })

  async function importToolsModule(tag: string) {
    return import(new URL(`./tools.ts?${tag}`, import.meta.url).href)
  }

  test("#given content mode #when grep executes #then it resolves the CLI with auto-install before runRg", async () => {
    // given
    const cli = { path: "/tmp/oh-my-opencode/bin/rg", backend: "rg" as const }
    const resolveGrepCliWithAutoInstallMock = mock(async () => cli)
    const runRgMock = mock(async () => ({
      matches: [{ file: "src/tools/grep/tools.ts", line: 12, text: "resolveGrepCliWithAutoInstall" }],
      totalMatches: 1,
      filesSearched: 1,
      truncated: false,
    }))
    const runRgCountMock = mock(async () => [])
    const formatGrepResultMock = mock(() => "formatted grep result")
    const formatCountResultMock = mock(() => "formatted count result")

    mock.module("./constants", () => ({ resolveGrepCliWithAutoInstall: resolveGrepCliWithAutoInstallMock }))
    mock.module("./constants.ts", () => ({ resolveGrepCliWithAutoInstall: resolveGrepCliWithAutoInstallMock }))
    mock.module(new URL("./constants.ts", import.meta.url).href, () => ({ resolveGrepCliWithAutoInstall: resolveGrepCliWithAutoInstallMock }))
    mock.module("./cli", () => ({ runRg: runRgMock, runRgCount: runRgCountMock }))
    mock.module("./cli.ts", () => ({ runRg: runRgMock, runRgCount: runRgCountMock }))
    mock.module(new URL("./cli.ts", import.meta.url).href, () => ({ runRg: runRgMock, runRgCount: runRgCountMock }))
    mock.module("./result-formatter", () => ({
      formatGrepResult: formatGrepResultMock,
      formatCountResult: formatCountResultMock,
    }))
    mock.module("./result-formatter.ts", () => ({
      formatGrepResult: formatGrepResultMock,
      formatCountResult: formatCountResultMock,
    }))
    mock.module(new URL("./result-formatter.ts", import.meta.url).href, () => ({
      formatGrepResult: formatGrepResultMock,
      formatCountResult: formatCountResultMock,
    }))

    const { createGrepTools } = await importToolsModule("grep-tools-content")
    const { grep } = createGrepTools(mockCtx)

    // when
    const result = await grep.execute({ pattern: "resolveGrepCliWithAutoInstall" }, mockContext)

    // then
    expect(result).toBe("formatted grep result")
    expect(resolveGrepCliWithAutoInstallMock).toHaveBeenCalledTimes(1)
    expect(runRgMock).toHaveBeenCalledWith(
      {
        pattern: "resolveGrepCliWithAutoInstall",
        paths: [projectDir],
        globs: undefined,
        context: 0,
        outputMode: "files_with_matches",
        headLimit: 0,
      },
      cli
    )
  })

  test("#given count mode #when grep executes #then it resolves the CLI with auto-install before runRgCount", async () => {
    // given
    const cli = { path: "/tmp/oh-my-opencode/bin/rg", backend: "rg" as const }
    const resolveGrepCliWithAutoInstallMock = mock(async () => cli)
    const runRgMock = mock(async () => ({
      matches: [],
      totalMatches: 0,
      filesSearched: 0,
      truncated: false,
    }))
    const runRgCountMock = mock(async () => [{ file: "src/tools/grep/tools.ts", count: 2 }])
    const formatGrepResultMock = mock(() => "formatted grep result")
    const formatCountResultMock = mock(() => "formatted count result")

    mock.module("./constants", () => ({ resolveGrepCliWithAutoInstall: resolveGrepCliWithAutoInstallMock }))
    mock.module("./constants.ts", () => ({ resolveGrepCliWithAutoInstall: resolveGrepCliWithAutoInstallMock }))
    mock.module(new URL("./constants.ts", import.meta.url).href, () => ({ resolveGrepCliWithAutoInstall: resolveGrepCliWithAutoInstallMock }))
    mock.module("./cli", () => ({ runRg: runRgMock, runRgCount: runRgCountMock }))
    mock.module("./cli.ts", () => ({ runRg: runRgMock, runRgCount: runRgCountMock }))
    mock.module(new URL("./cli.ts", import.meta.url).href, () => ({ runRg: runRgMock, runRgCount: runRgCountMock }))
    mock.module("./result-formatter", () => ({
      formatGrepResult: formatGrepResultMock,
      formatCountResult: formatCountResultMock,
    }))
    mock.module("./result-formatter.ts", () => ({
      formatGrepResult: formatGrepResultMock,
      formatCountResult: formatCountResultMock,
    }))
    mock.module(new URL("./result-formatter.ts", import.meta.url).href, () => ({
      formatGrepResult: formatGrepResultMock,
      formatCountResult: formatCountResultMock,
    }))

    const { createGrepTools } = await importToolsModule("grep-tools-count")
    const { grep } = createGrepTools(mockCtx)

    // when
    const result = await grep.execute({ pattern: "resolveGrepCliWithAutoInstall", output_mode: "count" }, mockContext)

    // then
    expect(result).toBe("formatted count result")
    expect(resolveGrepCliWithAutoInstallMock).toHaveBeenCalledTimes(1)
    expect(runRgCountMock).toHaveBeenCalledWith(
      {
        pattern: "resolveGrepCliWithAutoInstall",
        paths: [projectDir],
        globs: undefined,
      },
      cli
    )
  })
})
