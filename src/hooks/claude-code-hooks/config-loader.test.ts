const { afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getOpenCodeConfigDir } from "../../shared"

const { clearPluginExtendedConfigCache, loadPluginExtendedConfig } = await import("./config-loader")

describe("loadPluginExtendedConfig", () => {
  const originalDateNow = Date.now
  let originalWorkingDirectory = ""
  let tempDirectory = ""
  let userConfigPath = ""
  let projectConfigPath = ""
  let originalUserConfig: string | null = null
  let mockedNow = 0

  beforeEach(() => {
    //#given
    originalWorkingDirectory = process.cwd()
    tempDirectory = mkdtempSync(join(tmpdir(), "omo-cc-plugin-project-config-"))
    userConfigPath = join(getOpenCodeConfigDir({ binary: "opencode" }), "opencode-cc-plugin.json")
    projectConfigPath = join(tempDirectory, ".opencode", "opencode-cc-plugin.json")
    mkdirSync(getOpenCodeConfigDir({ binary: "opencode" }), { recursive: true })
    mkdirSync(join(tempDirectory, ".opencode"), { recursive: true })
    originalUserConfig = existsSync(userConfigPath)
      ? readFileSync(userConfigPath, "utf8")
      : null
    process.chdir(tempDirectory)
    mockedNow = 1_000
    Date.now = () => mockedNow
    clearPluginExtendedConfigCache()
  })

  afterEach(() => {
    clearPluginExtendedConfigCache()
    Date.now = originalDateNow
    process.chdir(originalWorkingDirectory)
    rmSync(tempDirectory, { recursive: true, force: true })
    if (originalUserConfig === null) {
      rmSync(userConfigPath, { force: true })
    } else {
      writeFileSync(userConfigPath, originalUserConfig)
    }
  })

  test("#given cached extended config #when files change within ttl #then cached config is reused", async () => {
    //#given
    writeConfigFile(userConfigPath, ["user-first"])
    writeConfigFile(projectConfigPath, ["project-first"])

    //#when
    const firstResult = await loadPluginExtendedConfig()
    writeConfigFile(userConfigPath, ["user-second"])
    writeConfigFile(projectConfigPath, ["project-second"])
    mockedNow += 5_000
    const secondResult = await loadPluginExtendedConfig()

    //#then
    expect(firstResult).toEqual({
      disabledHooks: {
        Stop: ["project-first"],
      },
    })
    expect(secondResult).toEqual(firstResult)
  })

  test("#given cached extended config #when ttl expires or cache clears #then updated config is reloaded", async () => {
    //#given
    writeConfigFile(userConfigPath, ["user-first"])
    writeConfigFile(projectConfigPath, ["project-first"])
    await loadPluginExtendedConfig()

    //#when
    writeConfigFile(userConfigPath, ["user-second"])
    writeConfigFile(projectConfigPath, ["project-second"])
    mockedNow += 31_000
    const ttlReloaded = await loadPluginExtendedConfig()

    writeConfigFile(userConfigPath, ["user-third"])
    writeConfigFile(projectConfigPath, ["project-third"])
    clearPluginExtendedConfigCache()
    const manuallyReloaded = await loadPluginExtendedConfig()

    //#then
    expect(ttlReloaded).toEqual({
      disabledHooks: {
        Stop: ["project-second"],
      },
    })
    expect(manuallyReloaded).toEqual({
      disabledHooks: {
        Stop: ["project-third"],
      },
    })
  })

  test("#given OPENCODE_CONFIG_DIR points at a profile dir after module import #when loading extended config #then it reads the profile config file", async () => {
    //#given
    const profileConfigDir = join(tempDirectory, ".config", "opencode", "profiles", "today")
    const profileConfigPath = join(profileConfigDir, "opencode-cc-plugin.json")
    mkdirSync(profileConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir
    writeConfigFile(profileConfigPath, ["profile-stop"])

    //#when
    clearPluginExtendedConfigCache()
    const result = await loadPluginExtendedConfig()

    //#then
    expect(result).toEqual({
      disabledHooks: {
        Stop: ["profile-stop"],
      },
    })
  })
})

function writeConfigFile(filePath: string, stopPatterns: string[]): void {
  writeFileSync(
    filePath,
    JSON.stringify({
      disabledHooks: {
        Stop: stopPatterns,
      },
    }),
  )
}

export {}
