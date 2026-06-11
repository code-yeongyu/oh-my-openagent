import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createHostConfigRoot, createHostConfigRoots } from "./config-roots"
import { resolveHostRuntimePaths } from "./runtime-paths"
import { findExistingHostSettingsFile, getHostSettingsCandidates } from "./settings-file"

const cwd = "/workspace/project"
const homeDir = "/home/supreme"

describe("host runtime path normalization", () => {
  test("#given Oh My Pi #when resolving paths #then uses the .omp agent roots", () => {
    // given
    const paths = resolveHostRuntimePaths({ host: "oh-my-pi", cwd, homeDir })

    // then
    expect(paths.userConfigDir).toBe(join(homeDir, ".omp", "agent"))
    expect(paths.projectConfigDir).toBe(join(cwd, ".omp"))
    expect(paths.extensionRoot).toBe(join(homeDir, ".omp", "agent", "extensions"))
  })

  test("#given Pi #when resolving paths #then uses the .pi agent roots", () => {
    // given
    const paths = resolveHostRuntimePaths({ host: "pi", cwd, homeDir })

    // then
    expect(paths.userConfigDir).toBe(join(homeDir, ".pi", "agent"))
    expect(paths.projectConfigDir).toBe(join(cwd, ".pi"))
    expect(paths.extensionRoot).toBe(join(homeDir, ".pi", "agent", "extensions"))
  })

  test("#given OpenCode explicit config dir #when resolving paths #then preserves current config directory behavior", () => {
    // given
    const openCodeConfigDir = "/tmp/opencode-config"

    // when
    const paths = resolveHostRuntimePaths({ host: "opencode", cwd, homeDir, openCodeConfigDir })

    // then
    expect(paths.userConfigDir).toBe(openCodeConfigDir)
    expect(paths.projectConfigDir).toBe(join(cwd, ".opencode"))
    expect(paths.extensionRoot).toBe(openCodeConfigDir)
  })

  test("#given no settings files exist #when creating config root #then settingsPath is omitted", () => {
    // when
    const root = createHostConfigRoot({
      host: "oh-my-pi",
      cwd,
      homeDir,
      existsPath: () => false,
    })

    // then
    expect(root.settingsPath).toBeUndefined()
    expect(root.extensionRoot).toBe(join(homeDir, ".omp", "agent", "extensions"))
  })

  test("#given Oh My Pi config.yml exists #when creating config root #then selects the existing settings path", () => {
    // given
    const expectedPath = join(homeDir, ".omp", "agent", "config.yml")

    // when
    const root = createHostConfigRoot({
      host: "oh-my-pi",
      cwd,
      homeDir,
      existsPath: (path) => path === expectedPath,
    })

    // then
    expect(root.settingsPath).toBe(expectedPath)
  })

  test("#given all hosts #when creating config roots #then returns one root per host", () => {
    // when
    const roots = createHostConfigRoots({
      hosts: ["opencode", "oh-my-pi", "pi"],
      cwd,
      homeDir,
      openCodeConfigDir: "/tmp/opencode-config",
    })

    // then
    expect(roots.map((root) => root.host)).toEqual(["opencode", "oh-my-pi", "pi"])
  })

  test("#given host paths #when listing settings candidates #then target-native files are ordered first", () => {
    // given
    const ohMyPiPaths = resolveHostRuntimePaths({ host: "oh-my-pi", cwd, homeDir })
    const piPaths = resolveHostRuntimePaths({ host: "pi", cwd, homeDir })

    // when
    const ohMyPiCandidates = getHostSettingsCandidates(ohMyPiPaths)
    const piCandidates = getHostSettingsCandidates(piPaths)

    // then
    expect(ohMyPiCandidates[0]?.path).toBe(join(homeDir, ".omp", "agent", "settings.json"))
    expect(ohMyPiCandidates[1]?.path).toBe(join(homeDir, ".omp", "agent", "config.yml"))
    expect(piCandidates[0]?.path).toBe(join(homeDir, ".pi", "agent", "settings.json"))
  })

  test("#given no settings candidate exists #when searching #then missing settings are handled without failure", () => {
    // given
    const paths = resolveHostRuntimePaths({ host: "pi", cwd, homeDir })

    // when
    const found = findExistingHostSettingsFile(paths, () => false)

    // then
    expect(found).toBeUndefined()
  })
})
