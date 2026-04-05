import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-cache__")
const TEST_OPENCODE_CACHE_DIR = join(TEST_CACHE_DIR, "opencode")
const TEST_USER_CONFIG_DIR = "/tmp/opencode-config"

let importCounter = 0

// Capture real modules BEFORE mocking
const _realConstants = require("../auto-update-checker/constants")
const _realLogger = require("../../shared/logger")

async function importFreshCacheModule(): Promise<typeof import("../auto-update-checker/cache")> {
  mock.module("../auto-update-checker/constants", () => ({
    CACHE_DIR: TEST_OPENCODE_CACHE_DIR,
    PACKAGE_NAME: "oh-my-opencode",
    NPM_REGISTRY_URL: "https://registry.npmjs.org/-/package/oh-my-opencode/dist-tags",
    NPM_FETCH_TIMEOUT: 5000,
    VERSION_FILE: join(TEST_OPENCODE_CACHE_DIR, "version"),
    INSTALLED_PACKAGE_JSON: join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-opencode", "package.json"),
    getUserConfigDir: () => TEST_USER_CONFIG_DIR,
    getUserOpencodeConfig: () => join(TEST_USER_CONFIG_DIR, "opencode.json"),
    getUserOpencodeConfigJsonc: () => join(TEST_USER_CONFIG_DIR, "opencode.jsonc"),
    getWindowsAppdataDir: () => null,
  }))

  mock.module("../../shared/logger", () => ({
    log: () => {},
  }))

  const cacheModule = await import(`../auto-update-checker/cache?test=${importCounter++}`)
  mock.restore()
  return cacheModule
}

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
  beforeEach(() => {
    resetTestCache()
  })

  afterEach(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true })
    }
  })

  it("invalidates the installed package from the OpenCode cache directory", async () => {
    const { invalidatePackage } = await importFreshCacheModule()

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

afterAll(() => {
  mock.module("../auto-update-checker/constants", () => _realConstants)
  mock.module("../../shared/logger", () => _realLogger)
  mock.restore()
})
