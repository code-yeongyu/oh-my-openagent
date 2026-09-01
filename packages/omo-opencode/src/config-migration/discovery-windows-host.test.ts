import { describe, expect, test } from "bun:test"
import { posix, win32 } from "node:path"

import {
  discoverLegacyConfigGroups,
  type ConfigMigrationDiscoveryFileSystem,
} from "./index"

function windowsMemoryFileSystem(paths: readonly string[]): ConfigMigrationDiscoveryFileSystem {
  const files = new Set(paths.map((path) => win32.normalize(path).toLowerCase()))
  return {
    existsSync: (path): boolean => files.has(win32.normalize(path).toLowerCase()),
    readdirSync: (): string[] => [],
    realpathSync: (path): string => win32.normalize(path),
  }
}

function posixMemoryFileSystem(paths: readonly string[]): ConfigMigrationDiscoveryFileSystem {
  const files = new Set(paths)
  return {
    existsSync: (path): boolean => files.has(path),
    readdirSync: (): string[] => [],
    realpathSync: (path): string => path,
  }
}

describe("legacy config discovery on Windows hosts", () => {
  test("#given posix path operations on a Windows host #when XDG, APPDATA, and Tauri sources exist #then discovers all roots and canonically deduplicates the XDG root", () => {
    // given
    const homeDir = "C:\\Users\\Alice"
    const xdgRoot = posix.join(homeDir, ".config", "opencode")
    const appData = "C:\\Users\\Alice\\AppData\\Roaming"
    const appDataRoot = win32.join(appData, "opencode")
    const tauriRoot = win32.join(appData, "ai.opencode.desktop")
    const tauriDevRoot = win32.join(appData, "ai.opencode.desktop.dev")

    // when
    const groups = discoverLegacyConfigGroups({
      cwd: "C:\\Users\\Alice\\project",
      environment: {
        APPDATA: appData,
        OPENCODE_CONFIG_DIR: xdgRoot,
        XDG_CONFIG_HOME: posix.join(homeDir, ".config"),
      },
      fileSystem: windowsMemoryFileSystem([
        posix.join(xdgRoot, "oh-my-openagent.jsonc"),
        win32.join(appDataRoot, "oh-my-openagent.jsonc"),
        win32.join(tauriRoot, "oh-my-openagent.jsonc"),
        win32.join(tauriDevRoot, "oh-my-opencode.json"),
      ]),
      homeDir,
      pathOperations: posix,
      platform: "win32",
    })

    // then
    expect(groups[0]?.sources.map((source) => source.path)).toEqual([
      win32.join(xdgRoot, "oh-my-openagent.jsonc"),
      win32.join(appDataRoot, "oh-my-openagent.jsonc"),
      win32.join(tauriRoot, "oh-my-openagent.jsonc"),
      win32.join(tauriDevRoot, "oh-my-opencode.json"),
    ])
  })

  test("#given a non-Windows host #when discovering the default XDG and Tauri roots #then source paths remain unchanged", () => {
    // given
    const homeDir = "/home/alice"
    const configHome = "/custom/config"

    // when
    const groups = discoverLegacyConfigGroups({
      cwd: "/home/alice/project",
      environment: { HOME: homeDir, XDG_CONFIG_HOME: configHome },
      fileSystem: posixMemoryFileSystem([
        `${configHome}/opencode/oh-my-openagent.jsonc`,
        `${configHome}/ai.opencode.desktop/oh-my-opencode.json`,
      ]),
      homeDir,
      pathOperations: posix,
      platform: "linux",
    })

    // then
    expect(groups[0]?.sources.map((source) => source.path)).toEqual([
      `${configHome}/opencode/oh-my-openagent.jsonc`,
      `${configHome}/ai.opencode.desktop/oh-my-opencode.json`,
    ])
  })
})
