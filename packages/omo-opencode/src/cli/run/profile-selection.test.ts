import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPluginConfig } from "../../plugin-config"
import { withRunProfile } from "./profile-selection"

const envKeys = ["HOME", "USERPROFILE", "OMO_PROFILE", "OCX_PROFILE", "OPENCODE_CONFIG_DIR"] as const
let savedEnv: Record<string, string | undefined>
let root: string
let directory: string
let configPath: string
let configText: string

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  root = mkdtempSync(join(tmpdir(), "omo-run-profile-"))
  directory = join(root, "project")
  mkdirSync(join(directory, ".omo"), { recursive: true })
  process.env.HOME = root
  process.env.USERPROFILE = root
  for (const key of envKeys.slice(2)) delete process.env[key]
  configPath = join(directory, ".omo", "omo.jsonc")
  configText = JSON.stringify({
    agents: { sisyphus: { model: "test/base" } },
    categories: { quick: { model: "test/base-category" } },
    profiles: {
      fast: {
        agents: { sisyphus: { model: "test/fast" } },
        categories: { quick: { model: "test/fast-category" } },
        "[opencode]": { categories: { quick: { model: "test/fast-opencode-category" } } },
      },
      deep: {
        agents: { sisyphus: { model: "test/deep" } },
        categories: { quick: { model: "test/deep-category" } },
      },
    },
  })
  writeFileSync(configPath, configText)
})

afterEach(() => {
  for (const key of envKeys) {
    const previous = savedEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  rmSync(root, { recursive: true, force: true })
})

describe("run profile selection", () => {
  it.each([
    ["fast", "test/fast", "test/fast-opencode-category"],
    ["deep", "test/deep", "test/deep-category"],
  ])("applies named %s agent and category overlays locally and passes selection to a child", async (profile, agentModel, categoryModel) => {
    // given
    let childProfile: string | undefined

    // when
    const config = await withRunProfile({ profile, directory }, async () => {
      const child = Bun.spawn([process.execPath, "--eval", "process.stdout.write(process.env.OMO_PROFILE ?? '')"], {
        env: { ...process.env }, stdout: "pipe", stderr: "pipe",
      })
      childProfile = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      return loadPluginConfig(directory, { command: "run" })
    })

    // then
    expect(config.agents?.sisyphus?.model).toBe(agentModel)
    expect(config.categories?.quick?.model).toBe(categoryModel)
    expect(childProfile).toBe(profile)
    expect(process.env.OMO_PROFILE).toBeUndefined()
    expect(readFileSync(configPath, "utf8")).toBe(configText)
  })

  it.each(["omo", "ocx", "directory"])("explicit profile wins over inherited %s selectors and restores them", async (source) => {
    // given
    process.env.OCX_PROFILE = "deep"
    process.env.OPENCODE_CONFIG_DIR = join(root, "profiles", "deep")
    if (source === "omo") process.env.OMO_PROFILE = "deep"
    if (source === "directory") delete process.env.OCX_PROFILE
    const previous = process.env.OMO_PROFILE

    // when
    const config = await withRunProfile({ profile: "fast", directory }, async () => loadPluginConfig(directory, {}))

    // then
    expect(config.agents?.sisyphus?.model).toBe("test/fast")
    expect(process.env.OMO_PROFILE).toBe(previous)
    expect(process.env.OCX_PROFILE).toBe(source === "directory" ? undefined : "deep")
    expect(process.env.OPENCODE_CONFIG_DIR).toBe(join(root, "profiles", "deep"))
  })

  it.each([undefined, "", "deep"])("restores prior OMO_PROFILE %j after a run error", async (previous) => {
    // given
    if (previous !== undefined) process.env.OMO_PROFILE = previous
    const failure = new Error("run failed")

    // when / then
    await expect(withRunProfile({ profile: "fast", directory }, async () => {
      expect(process.env.OMO_PROFILE).toBe("fast")
      throw failure
    })).rejects.toBe(failure)
    expect(process.env.OMO_PROFILE).toBe(previous)
  })

  it.each(["", " \t\n", "missing"])("rejects invalid explicit profile %j before executing a run", async (profile) => {
    // given
    process.env.OMO_PROFILE = "deep"
    let ran = false

    // when / then
    await expect(withRunProfile({ profile, directory }, async () => { ran = true })).rejects.toThrow(
      profile.trim() === "" ? "Profile name must not be blank" : 'Profile "missing" does not exist',
    )
    expect(ran).toBe(false)
    expect(process.env.OMO_PROFILE).toBe("deep")
  })

  it("rejects --attach with an explicit profile before executing a run", async () => {
    // given
    let ran = false

    // when / then
    await expect(withRunProfile({ profile: "fast", directory, attach: "http://localhost:4096" }, async () => {
      ran = true
    })).rejects.toThrow("--profile cannot be used with --attach")
    expect(ran).toBe(false)
    expect(process.env.OMO_PROFILE).toBeUndefined()
  })

  it("keeps inherited profile and attach behavior when the flag is absent", async () => {
    // given
    process.env.OMO_PROFILE = "deep"

    // when
    const config = await withRunProfile({ directory, attach: "http://localhost:4096" }, async () => loadPluginConfig(directory, {}))

    // then
    expect(config.agents?.sisyphus?.model).toBe("test/deep")
    expect(process.env.OMO_PROFILE).toBe("deep")
  })

  it("run validates profile before the main model and restores selection after a returned error", async () => {
    // given
    const errors: string[] = []
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")) })
    const previousClient = process.env.OPENCODE_CLIENT
    const previousRunMode = process.env.OPENCODE_CLI_RUN_MODE
    process.env.OMO_PROFILE = "deep"
    try {
      // Load after prior suites restore their runner dependency mocks.
      const runnerPath = "./runner?profile-selection-model-validation"
      const { run }: typeof import("./runner") = await import(runnerPath)

      // when / then
      expect(await run({ message: "test", profile: "missing", directory, model: "invalid", timestamp: false })).toBe(1)
      expect(errors.join("\n")).toContain('Profile "missing" does not exist')
      errors.length = 0
      expect(await run({ message: "test", profile: "fast", directory, model: "invalid", timestamp: false })).toBe(1)
      expect(errors.join("\n")).toContain("Model string must be in 'provider/model' format")
      expect(process.env.OMO_PROFILE).toBe("deep")
    } finally {
      errorSpy.mockRestore()
      if (previousClient === undefined) delete process.env.OPENCODE_CLIENT
      else process.env.OPENCODE_CLIENT = previousClient
      if (previousRunMode === undefined) delete process.env.OPENCODE_CLI_RUN_MODE
      else process.env.OPENCODE_CLI_RUN_MODE = previousRunMode
    }
  })
})
