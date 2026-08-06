import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { invalidatePackage } from "../auto-update-checker/cache"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-cache__")
const TEST_OPENCODE_CACHE_DIR = join(TEST_CACHE_DIR, "opencode")
const TEST_USER_CONFIG_DIR = "/tmp/opencode-config"

function testInvalidatePackage(packageName?: string): boolean {
  return invalidatePackage(packageName, {
    acceptedPackageNames: ["oh-my-opencode", "oh-my-openagent"],
    cacheDir: TEST_OPENCODE_CACHE_DIR,
    defaultPackageName: "oh-my-opencode",
    userConfigDir: TEST_USER_CONFIG_DIR,
  })
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
          "oh-my-openagent": {},
          "some-other-package": {},
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
    const rootSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "oh-my-opencode@latest")
    const rootAcceptedSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "oh-my-openagent@latest")
    const packagesSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "packages", "oh-my-opencode@latest")
    const packagesAcceptedSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "packages", "oh-my-openagent@latest")
    const otherSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "packages", "other@latest")
    mkdirSync(join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-openagent"), { recursive: true })
    mkdirSync(join(rootSpecifierDir, "node_modules", "oh-my-opencode"), { recursive: true })
    mkdirSync(join(rootAcceptedSpecifierDir, "node_modules", "oh-my-openagent"), { recursive: true })
    mkdirSync(join(packagesSpecifierDir, "node_modules", "oh-my-opencode"), { recursive: true })
    mkdirSync(join(packagesAcceptedSpecifierDir, "node_modules", "oh-my-openagent"), { recursive: true })
    mkdirSync(otherSpecifierDir, { recursive: true })

    const result = testInvalidatePackage()

    expect(result).toBe(true)
    expect(existsSync(rootSpecifierDir)).toBe(false)
    expect(existsSync(rootAcceptedSpecifierDir)).toBe(false)
    expect(existsSync(packagesSpecifierDir)).toBe(false)
    expect(existsSync(packagesAcceptedSpecifierDir)).toBe(false)
    expect(existsSync(otherSpecifierDir)).toBe(true)
    expect(existsSync(join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-opencode"))).toBe(false)
    expect(existsSync(join(TEST_OPENCODE_CACHE_DIR, "node_modules", "oh-my-openagent"))).toBe(false)

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
    expect(bunLock.packages?.["oh-my-openagent"]).toBeUndefined()
    expect(bunLock.packages?.["some-other-package"]).toEqual({})
    expect(bunLock.packages?.other).toEqual({})

    const explicitSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "some-other-package@latest")
    const acceptedSpecifierDir = join(TEST_OPENCODE_CACHE_DIR, "oh-my-openagent@beta")
    mkdirSync(explicitSpecifierDir, { recursive: true })
    mkdirSync(acceptedSpecifierDir, { recursive: true })

    const explicitResult = testInvalidatePackage("some-other-package")

    expect(explicitResult).toBe(true)
    expect(existsSync(explicitSpecifierDir)).toBe(false)
    expect(existsSync(acceptedSpecifierDir)).toBe(true)

    const explicitBunLock = JSON.parse(readFileSync(join(TEST_OPENCODE_CACHE_DIR, "bun.lock"), "utf-8")) as {
      packages?: Record<string, unknown>
    }
    expect(explicitBunLock.packages?.["some-other-package"]).toBeUndefined()
    expect(explicitBunLock.packages?.other).toEqual({})
  })
})
