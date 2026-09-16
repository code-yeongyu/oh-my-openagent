import { describe, expect, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "../schema"
import { BrowserAutomationProviderSchema } from "./browser-automation"
import { BuiltinSkillNameSchema } from "./agent-names"

// A migration input, never a shipped tool instruction.
const removedProvider = ["agent", "browser"].join("-")
const replacement = "use the built-in browser path: Bun.WebView / playwright-core scripts"

describe("browser provider removal", () => {
  test("rejects the removed provider with an actionable diagnostic", () => {
    // Given: a configuration value accepted before the breaking migration.
    const input = removedProvider
    // When: the provider boundary parses it.
    const result = BrowserAutomationProviderSchema.safeParse(input)
    // Then: the value is rejected, not silently defaulted.
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Removed provider was accepted")
    expect(result.error.issues).toMatchObject([{
      code: "invalid_value",
      message: `Browser provider ${JSON.stringify(input)} is no longer supported; ${replacement}`,
    }])
  })

  test("rejects the removed provider through the full plugin schema", () => {
    // Given: the canonical user-facing configuration key.
    const input = { browser_automation_engine: { provider: removedProvider } }
    // When: parsing a complete plugin configuration.
    const result = OhMyOpenCodeConfigSchema.safeParse(input)
    // Then: the error identifies the exact configuration key.
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Removed provider was accepted")
    expect(result.error.issues).toMatchObject([{
      path: ["browser_automation_engine", "provider"],
      message: `Browser provider ${JSON.stringify(removedProvider)} is no longer supported; ${replacement}`,
    }])
  })

  test("omits the retired skill from the builtin name schema", () => {
    // Given: the old builtin skill id.
    const input = removedProvider
    // When: parsing it as a builtin name.
    const result = BuiltinSkillNameSchema.safeParse(input)
    // Then: it is no longer a builtin.
    expect(result.success).toBe(false)
  })

  test.each(["playwright", "dev-browser", "playwright-cli"])("preserves provider %s", (provider) => {
    // Given: a supported provider.
    const input = { browser_automation_engine: { provider } }
    // When: parsing the plugin configuration.
    const result = OhMyOpenCodeConfigSchema.parse(input)
    // Then: selection is preserved.
    expect(result.browser_automation_engine?.provider).toBe(provider)
  })

  test.each([{ provider: null }, { provider: 42 }, { provider: {} }, { provider: ["playwright"] }])("rejects malformed provider %j", ({ provider }) => {
    // Given: a malformed boundary value.
    const input = { browser_automation_engine: { provider } }
    // When: parsing the plugin configuration.
    const result = OhMyOpenCodeConfigSchema.safeParse(input)
    // Then: malformed data is not converted to a valid provider.
    expect(result.success).toBe(false)
  })

  test("uses defaults when the browser configuration key is removed", () => {
    // Given: migration removed the obsolete configuration section.
    const input = {}
    // When: parsing the plugin configuration.
    const result = OhMyOpenCodeConfigSchema.parse(input)
    // Then: the default skill path is available without an override.
    expect(result.browser_automation_engine).toBeUndefined()
  })
})
