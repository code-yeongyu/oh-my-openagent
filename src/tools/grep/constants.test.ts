import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

type SpawnResult = {
  status: number | null
  stdout: string
}

describe("grep constants", () => {
  let originalPlatform: NodeJS.Platform

  beforeEach(() => {
    originalPlatform = process.platform
    mock.restore()
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    mock.restore()
  })

  function mockPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform, configurable: true })
  }

  function createSpawnSyncMock(paths: { rg?: string; grep?: string }) {
    return mock((_command: string, args: string[]): SpawnResult => {
      const binaryName = args[0]

      if (binaryName === "rg" && paths.rg) {
        return { status: 0, stdout: `${paths.rg}\n` }
      }

      if (binaryName === "grep" && paths.grep) {
        return { status: 0, stdout: `${paths.grep}\n` }
      }

      return { status: 1, stdout: "" }
    })
  }

  async function importConstantsModule(tag: string) {
    return import(new URL(`./constants.ts?${tag}`, import.meta.url).href)
  }

  test("#given only GNU grep is available #when auto-install succeeds #then it caches the downloaded ripgrep path", async () => {
    // given
    const spawnSyncMock = createSpawnSyncMock({ grep: "/usr/bin/grep" })
    const existsSyncMock = mock(() => false)
    const downloadAndInstallRipgrepMock = mock(async () => "/tmp/oh-my-opencode/bin/rg")
    const getInstalledRipgrepPathMock = mock(() => null)
    const logMock = mock(() => {})

    mock.module("node:child_process", () => ({ spawnSync: spawnSyncMock }))
    mock.module("node:fs", () => ({ existsSync: existsSyncMock }))
    mock.module("./downloader", () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module("./downloader.ts", () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module(new URL("./downloader.ts", import.meta.url).href, () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module("../../shared/logger", () => ({ log: logMock }))
    mock.module("../../shared/logger.ts", () => ({ log: logMock }))
    mock.module(new URL("../../shared/logger.ts", import.meta.url).href, () => ({ log: logMock }))

    const { resolveGrepCliWithAutoInstall } = await importConstantsModule("grep-cache-success")

    // when
    const firstResult = await resolveGrepCliWithAutoInstall()
    const secondResult = await resolveGrepCliWithAutoInstall()

    // then
    expect(firstResult).toEqual({ path: "/tmp/oh-my-opencode/bin/rg", backend: "rg" })
    expect(secondResult).toEqual({ path: "/tmp/oh-my-opencode/bin/rg", backend: "rg" })
    expect(downloadAndInstallRipgrepMock).toHaveBeenCalledTimes(1)
    expect(logMock).not.toHaveBeenCalled()
  })

  test("#given Windows resolves to placeholder rg #when auto-install succeeds #then it still downloads ripgrep", async () => {
    // given
    mockPlatform("win32")

    const spawnSyncMock = createSpawnSyncMock({})
    const existsSyncMock = mock(() => false)
    const downloadAndInstallRipgrepMock = mock(async () => "C:/Users/test/.cache/oh-my-opencode/bin/rg.exe")
    const getInstalledRipgrepPathMock = mock(() => null)
    const logMock = mock(() => {})

    mock.module("node:child_process", () => ({ spawnSync: spawnSyncMock }))
    mock.module("node:fs", () => ({ existsSync: existsSyncMock }))
    mock.module("./downloader", () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module("./downloader.ts", () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module(new URL("./downloader.ts", import.meta.url).href, () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module("../../shared/logger", () => ({ log: logMock }))
    mock.module("../../shared/logger.ts", () => ({ log: logMock }))
    mock.module(new URL("../../shared/logger.ts", import.meta.url).href, () => ({ log: logMock }))

    const { resolveGrepCliWithAutoInstall } = await importConstantsModule("grep-win32-placeholder")

    // when
    const result = await resolveGrepCliWithAutoInstall()

    // then
    expect(result).toEqual({ path: "C:/Users/test/.cache/oh-my-opencode/bin/rg.exe", backend: "rg" })
    expect(downloadAndInstallRipgrepMock).toHaveBeenCalledTimes(1)
    expect(logMock).not.toHaveBeenCalled()
  })

  test("#given only GNU grep is available #when auto-install fails #then it logs and falls back to GNU grep", async () => {
    // given
    const spawnSyncMock = createSpawnSyncMock({ grep: "/usr/bin/grep" })
    const existsSyncMock = mock(() => false)
    const downloadAndInstallRipgrepMock = mock(async () => {
      throw new Error("network down")
    })
    const getInstalledRipgrepPathMock = mock(() => null)
    const logMock = mock(() => {})

    mock.module("node:child_process", () => ({ spawnSync: spawnSyncMock }))
    mock.module("node:fs", () => ({ existsSync: existsSyncMock }))
    mock.module("./downloader", () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module("./downloader.ts", () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module(new URL("./downloader.ts", import.meta.url).href, () => ({
      downloadAndInstallRipgrep: downloadAndInstallRipgrepMock,
      getInstalledRipgrepPath: getInstalledRipgrepPathMock,
    }))
    mock.module("../../shared/logger", () => ({ log: logMock }))
    mock.module("../../shared/logger.ts", () => ({ log: logMock }))
    mock.module(new URL("../../shared/logger.ts", import.meta.url).href, () => ({ log: logMock }))

    const { resolveGrepCliWithAutoInstall } = await importConstantsModule("grep-grep-fallback")

    // when
    const result = await resolveGrepCliWithAutoInstall()

    // then
    expect(result).toEqual({ path: "/usr/bin/grep", backend: "grep" })
    expect(logMock).toHaveBeenCalledWith(
      "[oh-my-opencode] Failed to auto-install ripgrep. Falling back to GNU grep.",
      {
        error: "network down",
        grep_path: "/usr/bin/grep",
      }
    )
  })
})
