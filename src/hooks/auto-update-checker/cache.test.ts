import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as dataPath from "../../shared/data-path"
import * as opencodeConfigDir from "../../shared/opencode-config-dir"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-cache__")
const TEST_OPENCODE_CACHE_DIR = join(TEST_CACHE_DIR, "opencode")

function resetTestCache(): void {
  if (existsSync(TEST_CACHE_DIR)) {
    rmSync(TEST_CACHE_DIR, { recursive: true, force: true })
  }

  mkdirSync(join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-opencode"), { recursive: true })
  writeFileSync(
    join(TEST_OPENCODE_CACHE_DIR, "package.json"),
    JSON.stringify({ dependencies: { "oh-my-opencode": "latest", other: "1.0.0" } }, null, 2)
  )
  writeFileSync(
    join(TEST_OPENCODE_CACHE_DIR, "bun.lock"),
    JSON.stringify(
      {
        workspaces: {
          "": {
            dependencies: { "oh-my-opencode": "latest", other: "1.0.0" },
          },
        },
        packages: {
          "oh-my-opencode": {},
          other: {},
        },
      },
      null,
      2
    )
  )
  writeFileSync(
    join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-opencode", "package.json"),
    '{"name":"oh-my-opencode"}'
  )
}

describe("invalidatePackage", () => {
  let getOpenCodeCacheDirSpy: ReturnType<typeof spyOn>
  let getOpenCodeConfigDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    getOpenCodeCacheDirSpy = spyOn(dataPath, "getOpenCodeCacheDir").mockReturnValue(TEST_OPENCODE_CACHE_DIR)
    getOpenCodeConfigDirSpy = spyOn(opencodeConfigDir, "getOpenCodeConfigDir").mockReturnValue("/tmp/opencode-config")
    resetTestCache()
  })

  afterEach(() => {
    getOpenCodeCacheDirSpy.mockRestore()
    getOpenCodeConfigDirSpy.mockRestore()
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true })
    }
  })

  it("invalidates the installed package from the OpenCode cache directory", async () => {
    const { invalidatePackage } = await import(`./cache?test=${Date.now()}`)

    const result = invalidatePackage()

    expect(result).toBe(true)
    expect(existsSync(join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-opencode"))).toBe(false)

    const packageJson = JSON.parse(readFileSync(join(TEST_OPENCODE_CACHE_DIR, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    expect(packageJson.dependencies?.["oh-my-opencode"]).toBe("latest")
    expect(packageJson.dependencies?.other).toBe("1.0.0")

    const bunLock = JSON.parse(readFileSync(join(TEST_OPENCODE_CACHE_DIR, "bun.lock"), "utf-8")) as {
      workspaces?: { ""?: { dependencies?: Record<string, string> } }
      packages?: Record<string, unknown>
    }
    expect(bunLock.workspaces?.[""]?.dependencies?.["oh-my-opencode"]).toBe("latest")
    expect(bunLock.workspaces?.[""]?.dependencies?.other).toBe("1.0.0")
    expect(bunLock.packages?.["oh-my-opencode"]).toBeUndefined()
    expect(bunLock.packages?.other).toEqual({})
  })
})
