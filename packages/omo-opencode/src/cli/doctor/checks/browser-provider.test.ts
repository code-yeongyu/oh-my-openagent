import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkBrowserProvider } from "./browser-provider"

// doctor/runner.test.ts replaces the "./checks" module process-wide, so the registry is
// re-imported under a unique specifier to observe the real shipped composition.
async function registeredBrowserProviderCheck() {
  const registry = await import(`./index?browser-provider-registration=${Date.now()}-${Math.random()}`)
  return registry.getAllCheckDefinitions().find((check: { id: string }) => check.id === "browser-provider")
}

const removedProvider = ["agent", "browser"].join("-")
const removalMessage = `Browser provider ${JSON.stringify(removedProvider)} is no longer supported; use the built-in browser path: Bun.WebView / playwright-core scripts`

describe("browser provider doctor check", () => {
  let root: string
  let originalDirectory: string
  let originalEnvironment: Record<string, string | undefined>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "browser-provider-doctor-"))
    originalDirectory = process.cwd()
    originalEnvironment = Object.fromEntries(
      ["HOME", "USERPROFILE", "OMO_PROFILE", "OCX_PROFILE", "OPENCODE_CONFIG_DIR"].map((key) => [key, process.env[key]]),
    )
    for (const key of Object.keys(originalEnvironment)) delete process.env[key]
    process.env.HOME = root
    process.env.USERPROFILE = root
    mkdirSync(join(root, "project"))
    mkdirSync(join(root, ".omo"))
    process.chdir(join(root, "project"))
  })

  afterEach(() => {
    process.chdir(originalDirectory)
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })

  test.each(["user", "project", "profile"])("reports the removed provider in the active %s layer", async (layer) => {
    // Given: a real unified config, including the selected profile or project layer.
    const browserConfig = { browser_automation_engine: { provider: removedProvider } }
    const configDirectory = layer === "project" ? join(root, "project", ".omo") : join(root, ".omo")
    mkdirSync(configDirectory, { recursive: true })
    process.env.OMO_PROFILE = "qa"
    const config = layer === "profile"
      ? { profiles: { qa: { "[opencode]": browserConfig } } }
      : { "[opencode]": browserConfig }
    writeFileSync(join(configDirectory, "omo.jsonc"), JSON.stringify(config))
    // When: doctor executes the check.
    const result = await checkBrowserProvider()
    // Then: machine-readable failure includes the migration diagnostic and key.
    expect(result.status).toBe("fail")
    expect(result.issues).toEqual([expect.objectContaining({
      severity: "error",
      description: expect.stringContaining(removalMessage),
      affects: ["browser_automation_engine.provider"],
    })])
  })

  test("passes when the obsolete configuration key is removed", async () => {
    // Given: a migrated configuration.
    writeFileSync(join(root, ".omo", "omo.jsonc"), JSON.stringify({ "[opencode]": {} }))
    // When: doctor executes the check.
    const result = await checkBrowserProvider()
    // Then: browser configuration is clean.
    expect(result.status).toBe("pass")
    expect(result.issues).toEqual([])
  })

  test("runs as part of the shipped doctor registry", async () => {
    // Given: a configuration carrying the removed provider.
    writeFileSync(
      join(root, ".omo", "omo.jsonc"),
      JSON.stringify({ "[opencode]": { browser_automation_engine: { provider: removedProvider } } }),
    )
    // When: running the entry doctor registers for this check.
    const definition = await registeredBrowserProviderCheck()
    expect(definition).toBeDefined()
    if (!definition) throw new Error("Browser provider check is not registered")
    const result = await definition.check()
    // Then: the registered entry reports the same migration failure.
    expect(result.status).toBe("fail")
    expect(result.issues[0]?.description).toContain(removalMessage)
  })
})
