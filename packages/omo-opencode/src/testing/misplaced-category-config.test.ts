import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { getOpenCodeConfigDir, getOpenCodeConfigDiscoveryDirs } from "../shared"
import { getMisplacedCategoryConfigDiagnostics } from "./misplaced-category-config"

const roots: string[] = []
const DISCOVERY_ENV_KEYS = [
  "APPDATA",
  "HOME",
  "OCX_PROFILE",
  "OMO_PROFILE",
  "OPENCODE_CHANNEL",
  "OPENCODE_CLIENT",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
] as const
const previousDiscoveryEnv = Object.fromEntries(
  DISCOVERY_ENV_KEYS.map((key) => [key, process.env[key]]),
)
let isolationRoot: string | undefined

function fixtureRoot(): string {
  const root = mkdtempSync(join(isolationRoot ?? tmpdir(), "fixture-"))
  roots.push(root)
  return root
}

function misplacedConfig(): string {
  return `{
    "categories": {
      "deep": { "model": "provider/model" }
    }
  }`
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "omo-misplaced-category-"))
  isolationRoot = root
  roots.push(root)
  process.env.APPDATA = join(root, "appdata")
  process.env.HOME = join(root, "home")
  process.env.OPENCODE_CONFIG_DIR = join(root, "config")
  process.env.XDG_CONFIG_HOME = join(root, "xdg-config")
  delete process.env.OCX_PROFILE
  delete process.env.OMO_PROFILE
  delete process.env.OPENCODE_CONFIG
  delete process.env.OPENCODE_CONFIG_CONTENT
  delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
})

afterEach(() => {
  for (const key of DISCOVERY_ENV_KEYS) {
    const previous = previousDiscoveryEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  isolationRoot = undefined
})

describe("misplaced OpenCode category diagnostics", () => {
  test("#given inline config content with categories #when inspected #then its source is diagnosed", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    process.env.OPENCODE_CONFIG_DIR = join(root, "config")
    process.env.OPENCODE_CONFIG_CONTENT = misplacedConfig()

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) => message.includes("OPENCODE_CONFIG_CONTENT"))).toBe(true)
  })

  test("#given a symlinked profile config directory #when inspected #then its lexical profile name is retained", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const actualConfigDir = join(root, "actual-config")
    const profileConfigDir = join(root, "profiles", "focused")
    mkdirSync(actualConfigDir, { recursive: true })
    mkdirSync(join(root, "profiles"), { recursive: true })
    writeFileSync(join(actualConfigDir, "opencode.jsonc"), misplacedConfig())
    symlinkSync(actualConfigDir, profileConfigDir, process.platform === "win32" ? "junction" : "dir")
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) =>
      message.includes('profiles.focused."[opencode]".categories')
    )).toBe(true)
  })

  test("#given a named profile #when its categories are diagnosed #then the hint remains OpenCode-scoped", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const profileConfigDir = join(root, "profiles", "focused")
    mkdirSync(profileConfigDir, { recursive: true })
    writeFileSync(join(profileConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) =>
      message.includes('profiles.focused."[opencode]".categories')
    )).toBe(true)
    expect(diagnostics.some((message) =>
      message.includes("profiles.focused.categories")
    )).toBe(false)
  })

  test("#given a dotted profile name #when diagnosed #then it remains one configuration key", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const profileConfigDir = join(root, "profiles", "client.prod")
    mkdirSync(profileConfigDir, { recursive: true })
    writeFileSync(join(profileConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir
    process.env.OMO_PROFILE = "client.prod"

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) =>
      message.includes('profiles."client.prod"."[opencode]".categories')
    )).toBe(true)
  })

  test("#given OMO_PROFILE overrides the config-dir profile #when diagnosed #then the active profile wins", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const profileConfigDir = join(root, "profiles", "focused")
    mkdirSync(profileConfigDir, { recursive: true })
    writeFileSync(join(profileConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir
    process.env.OMO_PROFILE = "other"

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) =>
      message.includes('profiles.other."[opencode]".categories')
    )).toBe(true)
    expect(diagnostics.some((message) => message.includes("profiles.focused"))).toBe(false)
  })

  test("#given a profile and global OpenCode sources #when diagnosed #then only the profile source is qualified", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const profileConfigDir = join(root, "profiles", "focused")
    const profileSource = join(profileConfigDir, "opencode.jsonc")
    const globalConfigDir = join(process.env.XDG_CONFIG_HOME ?? "", "opencode")
    const globalSource = join(globalConfigDir, "opencode.jsonc")
    mkdirSync(profileConfigDir, { recursive: true })
    mkdirSync(globalConfigDir, { recursive: true })
    writeFileSync(profileSource, misplacedConfig())
    writeFileSync(globalSource, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir
    process.env.OMO_PROFILE = "other"

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)
    const profileDiagnostic = diagnostics.find((message) => message.includes(profileSource))
    const globalDiagnostic = diagnostics.find((message) => message.includes(globalSource))

    // then
    expect(profileDiagnostic).toContain('profiles.other."[opencode]".categories')
    expect(globalDiagnostic).toContain('~/.omo/omo.jsonc under "[opencode]".categories')
    expect(globalDiagnostic).not.toContain("profiles.other")
  })

  test("#given both OpenCode formats and legacy config #when inspected #then every loaded source is scanned", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const configDir = join(root, "config")
    const defaultConfigDir = join(process.env.XDG_CONFIG_HOME ?? "", "opencode")
    const legacyConfig = join(defaultConfigDir, "config.json")
    mkdirSync(configDir, { recursive: true })
    mkdirSync(defaultConfigDir, { recursive: true })
    writeFileSync(legacyConfig, misplacedConfig())
    writeFileSync(join(configDir, "config.json"), misplacedConfig())
    writeFileSync(join(configDir, "opencode.json"), misplacedConfig())
    writeFileSync(join(configDir, "opencode.jsonc"), "{}")
    process.env.OPENCODE_CONFIG_DIR = configDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.some((message) => message.includes(legacyConfig))).toBe(true)
    expect(diagnostics.some((message) =>
      message.includes(join(configDir, "config.json"))
    )).toBe(false)
    expect(diagnostics.some((message) => message.includes(join(configDir, "opencode.json")))).toBe(true)
    expect(diagnostics.some((message) => message.includes(join(configDir, "opencode.jsonc")))).toBe(false)
  })

  test("#given stable and dev Desktop versions #when discovery roots resolve #then only the active edition is included", () => {
    // given
    const stableDirectory = getOpenCodeConfigDir({
      binary: "opencode-desktop",
      checkExisting: false,
      version: "1.18.28",
    })
    const devDirectory = getOpenCodeConfigDir({
      binary: "opencode-desktop",
      checkExisting: false,
      version: "1.18.28-dev",
    })

    // when
    const stableDirectories = getOpenCodeConfigDiscoveryDirs({
      binary: "opencode-desktop",
      version: "1.18.28",
    })
    const devDirectories = getOpenCodeConfigDiscoveryDirs({
      binary: "opencode-desktop",
      version: "1.18.28-dev",
    })

    // then
    expect(stableDirectories).toContain(stableDirectory)
    expect(stableDirectories).not.toContain(devDirectory)
    expect(devDirectories).not.toContain(stableDirectory)
    expect(devDirectories).toContain(devDirectory)
  })

  test("#given home .opencode config outside project ancestry #when inspected #then the user source is scanned", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "external-workspace")
    const homeOpenCodeDir = join(homeDirectory, ".opencode")
    const source = join(homeOpenCodeDir, "opencode.jsonc")
    mkdirSync(homeOpenCodeDir, { recursive: true })
    writeFileSync(source, misplacedConfig())
    process.env.HOME = homeDirectory
    process.env.OPENCODE_CONFIG_DIR = join(root, "config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(source))).toBe(true)
    expect(diagnostics.some((message) =>
      message.includes('~/.omo/omo.jsonc under "[opencode]".categories.')
    )).toBe(true)
  })

  test("#given HOME and USERPROFILE differ #when defaults resolve #then the unified HOME wins", () => {
    // given
    const root = fixtureRoot()
    const configuredHome = join(root, "configured-home")
    const accountHomeDirectory = join(root, "account-home")
    const projectDirectory = join(accountHomeDirectory, "project")
    const source = join(configuredHome, ".opencode", "opencode.jsonc")
    mkdirSync(dirname(source), { recursive: true })
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(source, misplacedConfig())

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      accountHomeDirectory,
      environment: { HOME: configuredHome, USERPROFILE: accountHomeDirectory },
    })

    // then
    expect(diagnostics.some((message) => message.includes(source))).toBe(true)
  })

  test("#given a project below home #when ancestors are inspected #then discovery stops at home", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(homeDirectory, "project")
    const homeConfig = join(homeDirectory, "opencode.jsonc")
    const aboveHomeConfig = join(root, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(homeConfig, misplacedConfig())
    writeFileSync(aboveHomeConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(homeConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(aboveHomeConfig))).toBe(false)
  })

  test("#given a project outside home #when ancestors are inspected #then discovery reaches its root", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "unrelated-home")
    const projectDirectory = join(root, "workspace", "project")
    const ancestorConfig = join(root, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(ancestorConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(ancestorConfig))).toBe(true)
  })

  test("#given an existing user omo.json #when categories are diagnosed #then its extension is preserved", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const configDir = join(root, "opencode")
    mkdirSync(join(homeDirectory, ".omo"), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(homeDirectory, ".omo", "omo.json"), "{}")
    writeFileSync(join(configDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = configDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(join(root, "project"), {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) =>
      message.includes('~/.omo/omo.json under "[opencode]".categories.')
    )).toBe(true)
    expect(diagnostics.some((message) => message.includes("~/.omo/omo.jsonc."))).toBe(false)
  })

  test("#given an existing project omo.json #when categories are diagnosed #then its extension is preserved", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const projectConfigDir = join(projectDirectory, ".omo")
    const targetConfig = join(projectConfigDir, "omo.json")
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(targetConfig, "{}")
    writeFileSync(join(projectDirectory, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(targetConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(`${targetConfig}c`))).toBe(false)
  })

  test.skipIf(process.platform === "win32")(
    "#given a symlinked project omo.jsonc #when categories are diagnosed #then a loadable sibling is targeted",
    () => {
      // given
      const root = fixtureRoot()
      const homeDirectory = join(root, "home")
      const projectDirectory = join(root, "workspace")
      const projectConfigDir = join(projectDirectory, ".omo")
      const linkedConfig = join(projectConfigDir, "omo.jsonc")
      const targetConfig = join(projectConfigDir, "omo.json")
      const externalConfig = join(root, "external-omo.jsonc")
      mkdirSync(projectConfigDir, { recursive: true })
      writeFileSync(externalConfig, "{}")
      symlinkSync(externalConfig, linkedConfig, "file")
      writeFileSync(join(projectDirectory, "opencode.jsonc"), misplacedConfig())
      process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

      // when
      const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
        homeDirectory,
      })

      // then
      expect(diagnostics.some((message) => message.includes(targetConfig))).toBe(true)
      expect(diagnostics.some((message) => message.includes(linkedConfig))).toBe(false)
    },
  )

  test("#given a symlinked project .omo directory #when categories are diagnosed #then replacement is explicit", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const actualConfigDir = join(root, "actual-omo")
    const projectConfigDir = join(projectDirectory, ".omo")
    mkdirSync(projectDirectory, { recursive: true })
    mkdirSync(actualConfigDir, { recursive: true })
    writeFileSync(join(actualConfigDir, "omo.json"), "{}")
    symlinkSync(
      actualConfigDir,
      projectConfigDir,
      process.platform === "win32" ? "junction" : "dir",
    )
    writeFileSync(join(projectDirectory, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) =>
      message.includes("after replacing the symlinked") &&
      message.includes(".omo directory")
    )).toBe(true)
  })

  test("#given OPENCODE_CONFIG_DIR overlaps project config #when diagnosed #then project scope wins", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const openCodeConfigDir = join(projectDirectory, ".opencode")
    mkdirSync(openCodeConfigDir, { recursive: true })
    writeFileSync(join(openCodeConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = openCodeConfigDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain(join(".omo", "omo.jsonc"))
    expect(diagnostics[0]).not.toContain("~/.omo/")
  })

  test("#given a symlinked user .omo at the home boundary #when diagnosed #then user scope stays loadable", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(homeDirectory, "project")
    const actualConfigDir = join(root, "actual-user-omo")
    const userConfigDir = join(homeDirectory, ".omo")
    mkdirSync(projectDirectory, { recursive: true })
    mkdirSync(actualConfigDir, { recursive: true })
    writeFileSync(join(actualConfigDir, "omo.json"), "{}")
    symlinkSync(
      actualConfigDir,
      userConfigDir,
      process.platform === "win32" ? "junction" : "dir",
    )
    writeFileSync(join(homeDirectory, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) =>
      message.includes('~/.omo/omo.json under "[opencode]".categories.')
    )).toBe(true)
    expect(diagnostics.some((message) => message.includes("after replacing"))).toBe(false)
  })

  test("#given HOME differs from the account home #when diagnosed #then either boundary stops discovery", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "configured-home")
    const accountHomeDirectory = join(root, "account-home")
    const projectDirectory = join(accountHomeDirectory, "project")
    const accountHomeConfig = join(accountHomeDirectory, "opencode.jsonc")
    const aboveBoundaryConfig = join(root, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(accountHomeConfig, misplacedConfig())
    writeFileSync(aboveBoundaryConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      accountHomeDirectory,
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(accountHomeConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(aboveBoundaryConfig))).toBe(false)
    expect(diagnostics.some((message) =>
      message.includes('~/.omo/omo.jsonc under "[opencode]".categories.')
    )).toBe(true)
  })

  test("#given a symlink in project ancestry #when diagnosed #then lexical parents remain visible", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const actualWorkspace = join(root, "physical", "deep-workspace")
    const linkedWorkspace = join(homeDirectory, "linked-workspace")
    const projectDirectory = join(linkedWorkspace, "app")
    const homeConfig = join(homeDirectory, "opencode.jsonc")
    mkdirSync(join(actualWorkspace, "app"), { recursive: true })
    mkdirSync(homeDirectory, { recursive: true })
    symlinkSync(
      actualWorkspace,
      linkedWorkspace,
      process.platform === "win32" ? "junction" : "dir",
    )
    writeFileSync(homeConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      accountHomeDirectory: homeDirectory,
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(homeConfig))).toBe(true)
    expect(diagnostics.some((message) =>
      message.includes('~/.omo/omo.jsonc under "[opencode]".categories.')
    )).toBe(true)
  })

  test("#given project config discovery is disabled #when inspected #then project sources are skipped", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const projectConfigDir = join(projectDirectory, ".opencode")
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(join(projectConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "true"

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics).toEqual([])
  })

  test("#given a worktree boundary #when inspected #then parent project sources are skipped", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const worktreeDirectory = join(homeDirectory, "repo")
    const projectDirectory = join(worktreeDirectory, "packages", "app")
    const homeConfig = join(homeDirectory, "opencode.jsonc")
    const worktreeConfig = join(worktreeDirectory, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(homeConfig, misplacedConfig())
    writeFileSync(worktreeConfig, misplacedConfig())

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
      worktreeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(worktreeConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(homeConfig))).toBe(false)
  })

  test("#given project sources beyond the loader depth #when inspected #then unreachable targets are skipped", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const layerRoot = join(root, "layers")
    let projectDirectory = layerRoot
    for (let index = 0; index < 257; index += 1) {
      projectDirectory = join(projectDirectory, "d")
    }
    mkdirSync(projectDirectory, { recursive: true })
    let visibleAncestor = projectDirectory
    for (let index = 0; index < 255; index += 1) {
      visibleAncestor = dirname(visibleAncestor)
    }
    const hiddenAncestor = dirname(visibleAncestor)
    const visibleConfig = join(visibleAncestor, "opencode.jsonc")
    const hiddenConfig = join(hiddenAncestor, "opencode.jsonc")
    writeFileSync(visibleConfig, misplacedConfig())
    writeFileSync(hiddenConfig, misplacedConfig())

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(visibleConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(hiddenConfig))).toBe(false)
  })
})
