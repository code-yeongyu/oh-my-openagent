import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as pluginConfig from "../../plugin-config"
import * as connection from "./server-connection"
import { run } from "./runner"

const envKeys = ["HOME", "USERPROFILE", "OMO_PROFILE", "OPENCODE_CLIENT", "OPENCODE_CLI_RUN_MODE"] as const
let savedEnv: Record<string, string | undefined>
let root: string
let directory: string
let errors: string[]
let errorSpy: ReturnType<typeof spyOn>
let loadSpy: ReturnType<typeof spyOn<typeof pluginConfig, "loadPluginConfig">>
let serverSpy: ReturnType<typeof spyOn<typeof connection, "createServerConnection">>
let loadedModel: string | undefined
let spawnedProfile: string | undefined

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  root = mkdtempSync(join(tmpdir(), "omo-run-profile-boundary-"))
  directory = join(root, "project")
  mkdirSync(join(directory, ".omo"), { recursive: true })
  process.env.HOME = root
  process.env.USERPROFILE = root
  process.env.OMO_PROFILE = "deep"
  writeFileSync(join(directory, ".omo", "omo.jsonc"), JSON.stringify({ profiles: {
    deep: { agents: { sisyphus: { model: "test/deep" } } },
    fast: { agents: { sisyphus: { model: "test/fast" } } },
  } }))
  errors = []
  loadedModel = undefined
  spawnedProfile = undefined
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")) })
  const originalLoad = pluginConfig.loadPluginConfig
  loadSpy = spyOn(pluginConfig, "loadPluginConfig").mockImplementation((...args) => {
    const config = originalLoad(...args)
    loadedModel = config.agents?.sisyphus?.model
    return config
  })
  serverSpy = spyOn(connection, "createServerConnection").mockImplementation(async () => {
    spawnedProfile = process.env.OMO_PROFILE
    throw new Error("server startup failed")
  })
})

afterEach(() => {
  errorSpy.mockRestore()
  loadSpy.mockRestore()
  serverSpy.mockRestore()
  for (const key of envKeys) {
    const previous = savedEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  rmSync(root, { recursive: true, force: true })
})

describe("run profile boundary", () => {
  it.each(["", " \t", "missing"])("rejects invalid profile %j before local config loading or spawning", async (profile) => {
    // when
    const result = await run({ message: "test", profile, directory, timestamp: false })

    // then
    expect(result).toBe(1)
    expect(loadSpy).not.toHaveBeenCalled()
    expect(serverSpy).not.toHaveBeenCalled()
    expect(errors.join("\n")).toContain(profile.trim() === "" ? "Profile name must not be blank" : 'Profile "missing" does not exist')
    expect(process.env.OMO_PROFILE).toBe("deep")
  })

  it("passes the same explicit selection to the local loader and required new server, restoring it after failure", async () => {
    // when
    const result = await run({ message: "test", profile: "fast", directory, timestamp: false })

    // then
    expect(result).toBe(1)
    expect(loadedModel).toBe("test/fast")
    expect(spawnedProfile).toBe("fast")
    expect(serverSpy.mock.calls[0]?.[0].requireNewServer).toBe(true)
    expect(process.env.OMO_PROFILE).toBe("deep")
  })

  it("rejects explicit attach before local config loading or connecting", async () => {
    // when
    const result = await run({ message: "test", profile: "fast", directory, attach: "http://localhost:4096", timestamp: false })

    // then
    expect(result).toBe(1)
    expect(loadSpy).not.toHaveBeenCalled()
    expect(serverSpy).not.toHaveBeenCalled()
    expect(errors.join("\n")).toContain("--profile cannot be used with --attach")
  })
})
