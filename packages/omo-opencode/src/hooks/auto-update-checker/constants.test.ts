import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../../shared/data-path"

describe("auto-update-checker constants", () => {
  it("uses the OpenCode cache directory for installed package metadata", async () => {
    const { CACHE_DIR, INSTALLED_PACKAGE_JSON, PACKAGE_NAME } = await import(`./constants?test=${Date.now()}`)

    expect(CACHE_DIR).toBe(join(getOpenCodeCacheDir(), "packages"))
    expect(INSTALLED_PACKAGE_JSON).toBe(
      join(getOpenCodeCacheDir(), "packages", "node_modules", PACKAGE_NAME, "package.json")
    )
  })

  it("PACKAGE_NAME uses the canonical package name for new writes", async () => {
    // given

    // when
    const { PACKAGE_NAME } = await import(`./constants?test=${Date.now()}`)

    // then
    expect(PACKAGE_NAME).toBe("oh-my-openagent")
  })

  it("ACCEPTED_PACKAGE_NAMES contains both the canonical and aliased npm names (GH-3257)", async () => {
    const { ACCEPTED_PACKAGE_NAMES } = await import(`./constants?test=${Date.now()}`)

    expect(ACCEPTED_PACKAGE_NAMES).toContain("oh-my-opencode")
    expect(ACCEPTED_PACKAGE_NAMES).toContain("oh-my-openagent")
  })

  it("INSTALLED_PACKAGE_JSON_CANDIDATES covers every accepted package name (GH-3257)", async () => {
    const { ACCEPTED_PACKAGE_NAMES, INSTALLED_PACKAGE_JSON_CANDIDATES, CACHE_DIR } = await import(
      `./constants?test=${Date.now()}`
    )

    expect(INSTALLED_PACKAGE_JSON_CANDIDATES).toHaveLength(ACCEPTED_PACKAGE_NAMES.length)
    for (const name of ACCEPTED_PACKAGE_NAMES) {
      expect(INSTALLED_PACKAGE_JSON_CANDIDATES).toContain(
        join(CACHE_DIR, "node_modules", name, "package.json")
      )
    }
  })
})
