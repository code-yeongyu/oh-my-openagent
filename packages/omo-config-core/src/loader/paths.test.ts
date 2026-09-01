import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { resolveHomeDir, resolveOmoConfigPaths, resolveUserOmoConfigDirectory, resolveUserOmoConfigPath } from "./paths"

function makeHome(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-config-paths-"))
  const homeDir = join(root, "home")
  mkdirSync(homeDir, { recursive: true })
  return homeDir
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

describe("resolveHomeDir", () => {
  test("#given an absolute POSIX HOME #when resolving on any host #then its filesystem root is preserved", () => {
    expect(resolveHomeDir({ HOME: "/home/alice" })).toBe("/home/alice")
  })
})

describe("resolveUserOmoConfigDirectory", () => {
  test("#given a HOME #when resolving the user config directory #then it is ~/.omo", () => {
    // given
    const homeDir = makeHome()

    // when
    const directory = resolveUserOmoConfigDirectory({ HOME: homeDir })

    // then
    expect(directory).toBe(join(homeDir, ".omo"))
  })

  test("#given XDG_CONFIG_HOME is set #when resolving the user config directory #then it is ignored in favour of ~/.omo", () => {
    // given
    const homeDir = makeHome()
    const xdgConfigHome = join(homeDir, "xdg")

    // when
    const directory = resolveUserOmoConfigDirectory({ HOME: homeDir, XDG_CONFIG_HOME: xdgConfigHome })

    // then
    expect(directory).toBe(join(homeDir, ".omo"))
  })

  test("#given APPDATA set #when resolving the user config directory #then it is ignored in favour of ~/.omo", () => {
    // given
    const homeDir = makeHome()
    const appData = join(homeDir, "AppData", "Roaming")

    // when
    const directory = resolveUserOmoConfigDirectory({ HOME: homeDir, APPDATA: appData })

    // then
    expect(directory).toBe(join(homeDir, ".omo"))
  })

  test("#given USERPROFILE instead of HOME #when resolving the user config directory #then it is <USERPROFILE>/.omo", () => {
    // given
    const homeDir = makeHome()

    // when
    const directory = resolveUserOmoConfigDirectory({ USERPROFILE: homeDir })

    // then
    expect(directory).toBe(join(homeDir, ".omo"))
  })
})

describe("resolveUserOmoConfigPath", () => {
  test("#given a HOME #when resolving the user config path #then it is ~/.omo/omo.jsonc", () => {
    // given
    const homeDir = makeHome()

    // when
    const path = resolveUserOmoConfigPath({ HOME: homeDir })

    // then
    expect(path).toBe(join(homeDir, ".omo", "omo.jsonc"))
  })
})

describe("resolveOmoConfigPaths user candidate", () => {
  test("#given ~/.omo/omo.jsonc exists #when resolving candidates #then the user candidate is that file", () => {
    // given
    const homeDir = makeHome()
    const cwd = join(homeDir, "work")
    mkdirSync(cwd, { recursive: true })
    writeFile(join(homeDir, ".omo", "omo.jsonc"), "{}")

    // when
    const candidates = resolveOmoConfigPaths({ cwd, env: { HOME: homeDir }, platform: "linux" })

    // then
    expect(candidates[0]).toEqual({ path: join(homeDir, ".omo", "omo.jsonc"), scope: "user" })
  })

  test("#given only ~/.omo/omo.json exists #when resolving candidates #then the json fallback is selected", () => {
    // given
    const homeDir = makeHome()
    const cwd = join(homeDir, "work")
    mkdirSync(cwd, { recursive: true })
    writeFile(join(homeDir, ".omo", "omo.json"), "{}")

    // when
    const candidates = resolveOmoConfigPaths({ cwd, env: { HOME: homeDir }, platform: "linux" })

    // then
    expect(candidates[0]).toEqual({ path: join(homeDir, ".omo", "omo.json"), scope: "user" })
  })

  test("#given a legacy ~/.config/omo/omo.jsonc and no ~/.omo config #when resolving candidates #then the legacy file is never selected", () => {
    // given
    const homeDir = makeHome()
    const cwd = join(homeDir, "work")
    mkdirSync(cwd, { recursive: true })
    writeFile(join(homeDir, ".config", "omo", "omo.jsonc"), `{"task":{"default_concurrency":42}}`)

    // when
    const candidates = resolveOmoConfigPaths({ cwd, env: { HOME: homeDir }, platform: "linux" })

    // then
    expect(candidates.map((candidate) => candidate.path)).not.toContain(
      join(homeDir, ".config", "omo", "omo.jsonc"),
    )
    expect(candidates[0]).toEqual({ path: join(homeDir, ".omo", "omo.jsonc"), scope: "user" })
  })

  test("#given a project .omo config #when resolving candidates #then the user candidate stays first and project layers follow", () => {
    // given
    const homeDir = makeHome()
    const projectDir = join(homeDir, "work", "project")
    mkdirSync(projectDir, { recursive: true })
    writeFile(join(homeDir, ".omo", "omo.jsonc"), "{}")
    writeFile(join(projectDir, ".omo", "omo.jsonc"), "{}")

    // when
    const candidates = resolveOmoConfigPaths({ cwd: projectDir, env: { HOME: homeDir }, platform: "linux" })

    // then
    expect(candidates).toEqual([
      { path: join(homeDir, ".omo", "omo.jsonc"), scope: "user" },
      { path: join(projectDir, ".omo", "omo.jsonc"), scope: "project" },
    ])
  })
})
