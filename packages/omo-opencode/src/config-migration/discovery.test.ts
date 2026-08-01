import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, win32 } from "node:path"

import {
  CONFIG_JSONC_MIGRATION_ID,
  OPENCODE_CONFIG_MIGRATION_ID,
  discoverLegacyConfigGroups,
  type ConfigMigrationDiscoveryFileSystem,
} from "./index"

function memoryFileSystem(paths: readonly string[]): ConfigMigrationDiscoveryFileSystem {
  const files = new Set(paths.map((path) => win32.normalize(path).toLowerCase()))
  return {
    existsSync: (path): boolean => files.has(win32.normalize(path).toLowerCase()),
    readdirSync: (directory): string[] => {
      const prefix = `${win32.normalize(directory).replace(/[\\/]$/, "").toLowerCase()}\\`
      return [...new Set(
        [...files]
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split("\\")[0])
      )]
    },
    realpathSync: (path): string => win32.normalize(path),
  }
}

function shortPathMemoryFileSystem(
  shortHome: string,
  longHome: string,
  paths: readonly string[],
): ConfigMigrationDiscoveryFileSystem {
  const normalizedShortHome = win32.normalize(shortHome)
  const normalizedLongHome = win32.normalize(longHome)
  const normalize = (path: string): string => win32.normalize(path)
    .replace(normalizedShortHome, normalizedLongHome)
    .toLowerCase()
  const files = new Set(paths.map(normalize))
  const existsSync = (path: string): boolean => {
    const key = normalize(path)
    return files.has(key) || [...files].some((file) => file.startsWith(`${key}\\`))
  }
  return {
    existsSync,
    readdirSync: (directory): string[] => {
      const prefix = `${normalize(directory).replace(/[\\/]$/, "")}\\`
      return [...new Set(
        [...files]
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split("\\")[0])
      )]
    },
    realpathSync: (path): string => {
      if (!existsSync(path)) throw Object.assign(new Error(`Missing ${path}`), { code: "ENOENT" })
      return win32.normalize(path).replace(normalizedShortHome, normalizedLongHome)
    },
  }
}

function withProcessPlatform<T>(platform: NodeJS.Platform, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")
  if (descriptor === undefined) throw new Error("Missing process.platform descriptor")
  Object.defineProperty(process, "platform", { ...descriptor, value: platform })
  try {
    return callback()
  } finally {
    Object.defineProperty(process, "platform", descriptor)
  }
}

describe("legacy config discovery", () => {
  test("#given a custom active profile, default config, Tauri config, and walked project config #when discovering sources #then roots are deduplicated and separated from config.jsonc", () => {
    // given
    const homeDir = "/home/alice"
    const customProfileDir = "/home/alice/.config/opencode/profiles/kimi/"
    const fileSystem: ConfigMigrationDiscoveryFileSystem = {
      existsSync: (path): boolean => new Set([
        "/home/alice/.config/opencode/oh-my-openagent.jsonc",
        "/home/alice/.config/opencode/profiles/kimi/oh-my-openagent.jsonc",
        "/home/alice/.config/opencode/profiles/quiet/oh-my-opencode.json",
        "/home/alice/.config/ai.opencode.desktop/oh-my-openagent.json",
        "/work/repo/.opencode/oh-my-openagent.jsonc",
        "/home/alice/.omo/config.jsonc",
      ]).has(path),
      readdirSync: (path): string[] => path === "/home/alice/.config/opencode/profiles"
        ? ["kimi", "quiet", "__test"]
        : [],
      realpathSync: (path): string => path.replace(/\/$/, ""),
    }

    // when
    const groups = discoverLegacyConfigGroups({
      cwd: "/work/repo/packages/app",
      environment: {
        HOME: homeDir,
        OPENCODE_CONFIG_DIR: customProfileDir,
        XDG_CONFIG_HOME: "/home/alice/.config",
      },
      fileSystem,
      homeDir,
      pathOperations: posix,
      platform: "linux",
    })

    // then
    expect(groups.map((group) => group.id)).toEqual([
      OPENCODE_CONFIG_MIGRATION_ID,
      CONFIG_JSONC_MIGRATION_ID,
    ])
    const opencodeGroup = groups[0]
    expect(opencodeGroup.sources.map((source) => source.path)).toEqual([
      "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      "/home/alice/.config/opencode/profiles/kimi/oh-my-openagent.jsonc",
      "/home/alice/.config/opencode/profiles/quiet/oh-my-opencode.json",
      "/home/alice/.config/ai.opencode.desktop/oh-my-openagent.json",
      "/work/repo/.opencode/oh-my-openagent.jsonc",
    ])
    expect(opencodeGroup.sources.find((source) => source.profile === "kimi")).toMatchObject({
      baseRoot: "/home/alice/.config/opencode",
      isActiveProfile: true,
      kind: "profile-config",
    })
    expect(opencodeGroup.sources.filter((source) => source.path.includes("/profiles/kimi/")).length).toBe(1)
    expect(opencodeGroup.sources.some((source) => source.path.includes("__test"))).toBe(false)
    expect(groups[1].sources).toEqual([
      expect.objectContaining({ kind: "config-jsonc", path: "/home/alice/.omo/config.jsonc" }),
    ])
  })

  test("#given an injected Windows filesystem #when its short path expands through realpath #then discovery keeps the canonical source within the config root", () => {
    // given
    const shortHome = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\omo-config-migrate-A1B2\\home"
    const longHome = "C:\\Users\\runner\\AppData\\Local\\Temp\\omo-config-migrate-A1B2\\home"
    const sourcePath = win32.join(shortHome, ".config", "opencode", "oh-my-openagent.json")

    // when
    const groups = withProcessPlatform("win32", () => discoverLegacyConfigGroups({
      cwd: win32.join(shortHome, "project"),
      environment: { HOME: shortHome, OPENCODE_CONFIG_DIR: win32.join(shortHome, ".config", "opencode") },
      fileSystem: shortPathMemoryFileSystem(shortHome, longHome, [sourcePath]),
      homeDir: shortHome,
      pathOperations: win32,
      platform: "linux",
    }))

    // then
    expect(groups[0]?.sources).toEqual([
      expect.objectContaining({
        configPath: win32.join(longHome, ".config", "opencode", "oh-my-openagent.json"),
        path: win32.join(longHome, ".config", "opencode", "oh-my-openagent.json"),
      }),
    ])
  })

  test("#given win32, WSL, trailing separators, casing, and a symlinked profile directory #when discovering #then injected path semantics keep each source canonical", () => {
    // given
    const windows = discoverLegacyConfigGroups({
      cwd: "C:\\Users\\Alice\\work\\repo",
      environment: {
        APPDATA: "c:\\users\\alice\\AppData\\Roaming\\",
        HOME: "C:\\Users\\Alice",
        OPENCODE_CONFIG_DIR: "C:\\USERS\\ALICE\\APPDATA\\ROAMING\\OPENCODE\\profiles\\Kimi\\",
      },
      fileSystem: memoryFileSystem([
        "C:\\Users\\Alice\\AppData\\Roaming\\opencode\\oh-my-openagent.jsonc",
        "C:\\Users\\Alice\\AppData\\Roaming\\opencode\\profiles\\kimi\\oh-my-openagent.jsonc",
      ]),
      homeDir: "C:\\Users\\Alice",
      pathOperations: win32,
      platform: "win32",
    })
    const createdDirectories: string[] = []
    const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-config-discovery-"))
    createdDirectories.push(fixtureRoot)
    const profileTarget = join(fixtureRoot, "profile-target")
    const profilesDir = join(fixtureRoot, "opencode", "profiles")
    mkdirSync(profileTarget, { recursive: true })
    mkdirSync(profilesDir, { recursive: true })
    writeFileSync(join(profileTarget, "oh-my-openagent.jsonc"), "{}")
    symlinkSync(profileTarget, join(profilesDir, "linked"))

    try {
      // when
      const symlinked = discoverLegacyConfigGroups({
        cwd: fixtureRoot,
        environment: { HOME: fixtureRoot, XDG_CONFIG_HOME: fixtureRoot },
        homeDir: fixtureRoot,
        pathOperations: posix,
        platform: "linux",
      })
      const wsl = discoverLegacyConfigGroups({
        cwd: "/home/alice/work",
        environment: {
          HOME: "/home/alice",
          OPENCODE_CONFIG_DIR: "/mnt/c/Users/Alice/.config/opencode/profiles/kimi/",
          WSL_DISTRO_NAME: "Ubuntu",
          XDG_CONFIG_HOME: "/mnt/c/Users/Alice/.config",
        },
        fileSystem: {
          existsSync: (path): boolean => path === "/mnt/c/Users/Alice/.config/opencode/profiles/kimi/oh-my-openagent.jsonc",
          readdirSync: (path): string[] => path === "/mnt/c/Users/Alice/.config/opencode/profiles" ? ["kimi"] : [],
          realpathSync: (path): string => path.replace(/\/$/, ""),
        },
        homeDir: "/home/alice",
        pathOperations: posix,
        platform: "linux",
      })

      // then
      expect(windows[0].sources).toHaveLength(2)
      expect(windows[0].sources.find((source) => source.profile === "kimi")).toMatchObject({
        baseRoot: "C:\\USERS\\ALICE\\APPDATA\\ROAMING\\OPENCODE",
        isActiveProfile: true,
      })
      expect(wsl[0].sources.find((source) => source.profile === "kimi")).toMatchObject({
        baseRoot: "/mnt/c/Users/Alice/.config/opencode",
        isActiveProfile: true,
      })
      expect(symlinked[0].sources).toEqual([
        expect.objectContaining({
          kind: "profile-config",
          path: realpathSync(join(profileTarget, "oh-my-openagent.jsonc")),
          profile: "linked",
        }),
      ])
    } finally {
      for (const directory of createdDirectories) rmSync(directory, { force: true, recursive: true })
    }
  })
})
