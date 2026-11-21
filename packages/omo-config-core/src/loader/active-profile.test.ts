import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { loadOmoConfig, readOmoProfileState, resolveOmoProfileName } from "../index"

const PROFILE_CONFIG = `{
  "active_profile": "gpt",
  "categories": { "quick": { "model": "base-model" } },
  "profiles": {
    "kimi": { "categories": { "quick": { "model": "kimi-model" } } },
    "gpt": { "categories": { "quick": { "model": "gpt-model" } } }
  }
}`

const fixtureRoots = new Set<string>()

afterEach(() => {
  for (const root of fixtureRoots) rmSync(root, { force: true, recursive: true })
  fixtureRoots.clear()
})

function makeFixture(config: string, projectConfig?: string): { readonly cwd: string; readonly homeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-active-profile-"))
  fixtureRoots.add(root)
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "work")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(homeDir, ".omo", "omo.jsonc"), config)
  if (projectConfig !== undefined) {
    mkdirSync(join(cwd, ".omo"), { recursive: true })
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), projectConfig)
  }
  return { cwd, homeDir }
}

describe("persisted active profile", () => {
  test("#given every activation source #when resolving #then explicit and environment values precede persisted state", () => {
    expect(resolveOmoProfileName({ env: { OMO_PROFILE: "kimi" }, persisted: "gpt", profile: "explicit" })).toBe("explicit")
    expect(resolveOmoProfileName({ env: { OMO_PROFILE: "kimi" }, persisted: "gpt" })).toBe("kimi")
    expect(resolveOmoProfileName({ env: { OCX_PROFILE: "kimi" }, persisted: "gpt" })).toBe("kimi")
    expect(resolveOmoProfileName({ env: { OPENCODE_CONFIG_DIR: "/tmp/profiles/kimi" }, persisted: "gpt" })).toBe("kimi")
    expect(resolveOmoProfileName({ env: {}, persisted: "gpt" })).toBe("gpt")
  })

  test("#given active_profile #when loading #then its profile applies without leaking the control key", () => {
    const fixture = makeFixture(PROFILE_CONFIG)

    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    expect(loaded.profile).toBe("gpt")
    expect(loaded.config.categories?.["quick"]?.model).toBe("gpt-model")
    expect(Object.keys(loaded.config)).not.toContain("active_profile")
  })

  test("#given an environment activation over persisted state #when loading #then the environment profile applies", () => {
    const fixture = makeFixture(PROFILE_CONFIG)

    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir, OMO_PROFILE: "kimi" } })

    expect(loaded.profile).toBe("kimi")
    expect(loaded.config.categories?.["quick"]?.model).toBe("kimi-model")
  })

  test("#given a missing persisted profile #when loading #then base config and a diagnostic are returned", () => {
    const fixture = makeFixture(`{
      "active_profile": "missing",
      "categories": { "quick": { "model": "base-model" } },
      "profiles": { "gpt": { "categories": { "quick": { "model": "gpt-model" } } } }
    }`)

    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })
    const state = readOmoProfileState({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    expect(loaded.profile).toBeUndefined()
    expect(loaded.config.categories?.["quick"]?.model).toBe("base-model")
    expect(loaded.diagnostics.some((diagnostic) => diagnostic.kind === "profile")).toBe(true)
    expect(state.active).toBeUndefined()
    expect(state.requested).toEqual({ name: "missing", origin: "persisted" })
  })

  test("#given project active_profile #when loading #then it is ignored with a diagnostic", () => {
    const fixture = makeFixture(PROFILE_CONFIG, `{ "active_profile": "kimi" }`)

    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    expect(loaded.profile).toBe("gpt")
    expect(loaded.config.categories?.["quick"]?.model).toBe("gpt-model")
    expect(loaded.diagnostics.some((diagnostic) => diagnostic.message.includes(`Ignoring "active_profile"`))).toBe(true)
  })

  test("#given only project active_profile #when loading #then no profile is activated", () => {
    const fixture = makeFixture(`{
      "categories": { "quick": { "model": "base-model" } },
      "profiles": { "gpt": { "categories": { "quick": { "model": "gpt-model" } } } }
    }`, `{ "active_profile": "gpt" }`)

    const loaded = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    expect(loaded.profile).toBeUndefined()
    expect(loaded.config.categories?.["quick"]?.model).toBe("base-model")
  })
})

describe("readOmoProfileState", () => {
  test("#given profiles and persisted state #when reading #then names are sorted and the origin is reported", () => {
    const fixture = makeFixture(PROFILE_CONFIG)

    const state = readOmoProfileState({ cwd: fixture.cwd, env: { HOME: fixture.homeDir } })

    expect(state.profiles).toEqual(["gpt", "kimi"])
    expect(state.persisted).toBe("gpt")
    expect(state.active).toEqual({ name: "gpt", origin: "persisted" })
  })

  test("#given OMO_PROFILE over persisted state #when reading #then the environment origin is reported", () => {
    const fixture = makeFixture(PROFILE_CONFIG)

    const state = readOmoProfileState({ cwd: fixture.cwd, env: { HOME: fixture.homeDir, OMO_PROFILE: "kimi" } })

    expect(state.persisted).toBe("gpt")
    expect(state.active).toEqual({ name: "kimi", origin: "OMO_PROFILE" })
  })
})
