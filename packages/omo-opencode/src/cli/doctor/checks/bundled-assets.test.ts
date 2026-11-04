import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function createSandboxDirs(): string {
  return mkdtempSync(join(tmpdir(), "omo-doctor-bundled-assets-"))
}

function writePackageRoot(rootDir: string, options: { omitAsset?: string; version?: string; legacy?: boolean } = {}): string {
  const version = options.version ?? "9.9.9"
  const installDir = options.legacy ? rootDir : join(rootDir, "packages", `oh-my-openagent@${version}`)
  const packageRoot = join(installDir, "node_modules", "oh-my-openagent")
  const assets = [
    "dist/index.js",
    "bin/platform.js",
    "dist/skills/frontend/SKILL.md",
  ]
  for (const asset of assets) {
    if (asset === options.omitAsset) continue
    const assetPath = join(packageRoot, asset)
    mkdirSync(join(assetPath, ".."), { recursive: true })
    writeFileSync(assetPath, "// asset", "utf-8")
  }
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "oh-my-openagent", version }, null, 2) + "\n",
    "utf-8",
  )
  return packageRoot
}

async function withCacheSandbox(run: (cacheDir: string, configDir: string) => Promise<void>): Promise<void> {
  const originalXdgCacheHome = process.env.XDG_CACHE_HOME
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
  const rootDir = createSandboxDirs()
  const cacheHome = join(rootDir, "cache")
  const configDir = join(rootDir, "config")
  try {
    process.env.XDG_CACHE_HOME = cacheHome
    process.env.OPENCODE_CONFIG_DIR = configDir
    mkdirSync(configDir)
    await run(join(cacheHome, "opencode"), configDir)
  } finally {
    if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalXdgCacheHome
    if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    rmSync(rootDir, { recursive: true, force: true })
  }
}

describe("bundled assets check", () => {
  it("#given a complete package root #when evaluating bundled assets #then nothing is missing", async () => {
    //#given a package root containing every required asset
    const rootDir = createSandboxDirs()
    try {
      const packageRoot = writePackageRoot(rootDir)
      const { evaluateBundledAssets } = await import("./bundled-assets")

      //#when evaluating bundled assets
      const evaluation = evaluateBundledAssets(packageRoot)

      //#then no assets are missing
      expect(evaluation.packageRoot).toBe(packageRoot)
      expect(evaluation.missingAssets).toEqual([])
      expect(evaluation.checkedAssets.length).toBe(3)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it("#given a package root missing a bundled skill file #when evaluating bundled assets #then exactly that asset is reported missing", async () => {
    //#given a package root without dist/skills/frontend/SKILL.md
    const rootDir = createSandboxDirs()
    try {
      const packageRoot = writePackageRoot(rootDir, { omitAsset: "dist/skills/frontend/SKILL.md" })
      const { evaluateBundledAssets } = await import("./bundled-assets")

      //#when evaluating bundled assets
      const evaluation = evaluateBundledAssets(packageRoot)

      //#then the skill file is the only missing asset
      expect(evaluation.missingAssets).toEqual(["dist/skills/frontend/SKILL.md"])
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it("#given a null package root #when evaluating bundled assets #then the evaluation is empty", async () => {
    //#given no resolved package root
    const { evaluateBundledAssets } = await import("./bundled-assets")

    //#when evaluating bundled assets
    const evaluation = evaluateBundledAssets(null)

    //#then no assets were checked and none are missing
    expect(evaluation.packageRoot).toBeNull()
    expect(evaluation.checkedAssets).toEqual([])
    expect(evaluation.missingAssets).toEqual([])
  })

  it("fails with reinstall guidance when the cached install is incomplete", async () => {
    //#given an opencode cache containing an incomplete plugin install
    await withCacheSandbox(async (cacheDir) => {
      const packageRoot = writePackageRoot(cacheDir, {
        omitAsset: "dist/skills/frontend/SKILL.md",
      })
      const { checkBundledAssets } = await import("./bundled-assets")

      //#when running the bundled assets check
      const result = await checkBundledAssets()

      //#then the check fails and names the missing asset plus the fix
      expect(result.status).toBe("fail")
      expect(result.issues.length).toBe(1)
      expect(result.issues[0].severity).toBe("error")
      expect(result.issues[0].description).toContain(join(packageRoot, "dist/skills/frontend/SKILL.md"))
      expect(result.issues[0].fix).toContain("restart OpenCode")
    })
  })

  it.each([false, true])("checks the configured version even with an older tagged cache (legacy layout: %s)", async (legacy) => {
    await withCacheSandbox(async (cacheDir, configDir) => {
      // given a complete stale cache and a pinned install missing its skill
      writeFileSync(join(configDir, "opencode.json"), '{"plugin":[["oh-my-openagent@9.9.9",{}]]}')
      writePackageRoot(cacheDir, { version: "8.8.8" })
      const packageRoot = writePackageRoot(cacheDir, { legacy, omitAsset: "dist/skills/frontend/SKILL.md" })
      const { checkBundledAssets } = await import("./bundled-assets")

      // when the bundled assets check runs
      const result = await checkBundledAssets()

      // then it reports the missing skill in the pinned install
      expect(result.status).toBe("fail")
      expect(result.issues[0]?.description).toContain(join(packageRoot, "dist/skills/frontend/SKILL.md"))
    })
  })

  it("skips when only a different cached version exists", async () => {
    await withCacheSandbox(async (cacheDir, configDir) => {
      // given a pinned version that has yet to be installed
      writeFileSync(join(configDir, "opencode.json"), '{"plugin":["oh-my-openagent@9.9.9"]}')
      writePackageRoot(cacheDir, { version: "8.8.8" })
      const { checkBundledAssets } = await import("./bundled-assets")

      // when the bundled assets check runs
      const result = await checkBundledAssets()

      // then it does not report the stale cache as the pinned install
      expect(result.status).toBe("skip")
    })
  })

  it("skips with no OpenCode install even when running from the source checkout", async () => {
    await withCacheSandbox(async () => {
      // given empty config and cache directories
      const { checkBundledAssets } = await import("./bundled-assets")

      // when the bundled assets check runs
      const result = await checkBundledAssets()

      // then it skips instead of inspecting the doctor's own package
      expect(result.status).toBe("skip")
    })
  })
})
