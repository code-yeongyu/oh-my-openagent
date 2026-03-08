import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../../shared/data-path"

describe("auto-update-checker constants", () => {
  it("uses the OpenCode cache directory for installed package metadata", async () => {
    const { CACHE_DIR, INSTALLED_PACKAGE_JSON, PACKAGE_NAME } = await import(`./constants?test=${Date.now()}`)

    expect(CACHE_DIR).toBe(getOpenCodeCacheDir())
    expect(INSTALLED_PACKAGE_JSON).toBe(
      join(getOpenCodeCacheDir(), "node_modules", PACKAGE_NAME, "package.json")
    )
  })
})
