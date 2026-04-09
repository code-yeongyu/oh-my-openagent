/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { publishPlatformBatch, publishPlatformPair } from "./publish"

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.env.HOME ?? process.cwd(), "tmp")
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe("script/publish.ts", () => {
  test("tracks the full canonical platform package matrix", () => {
    const script = readFileSync(new URL("./publish.ts", import.meta.url), "utf8")

    expect(script).toContain('"darwin-x64-baseline"')
    expect(script).toContain('"linux-x64-baseline"')
    expect(script).toContain('"linux-x64-musl-baseline"')
    expect(script).toContain('"windows-x64-baseline"')
    expect(script).toContain('const totalPackages = PLATFORM_PACKAGES.length * 2 + 2')
  })

  test("skips alias platform publish when canonical platform publish fails", () => {
    const script = readFileSync(new URL("./publish.ts", import.meta.url), "utf8")

    expect(script).toContain("if (!result.success) {")
    expect(script).toContain("aliasResult: null")
    expect(script).toContain("Skipping ${aliasPkgName} because ${pkgName} failed")
    expect(script).toContain("if (!aliasResult) {")
  })

  test("converts alias generation throws into structured alias publish failures", () => {
    const script = readFileSync(new URL("./publish.ts", import.meta.url), "utf8")

    expect(script).toContain("try {")
    expect(script).toContain("createAliasPlatformPackage(pkgDir, aliasDir)")
    expect(script).toContain("} catch (error) {")
    expect(script).toContain("aliasResult: {")
    expect(script).toContain("error: error instanceof Error ? error.message : String(error)")
  })

  test("returns structured alias failure when alias generation throws", async () => {
    const calls: string[] = []

    const outcome = await publishPlatformPair("linux-x64", "1.2.3", "next", {
      publishPackage: async (cwd, distTag, useProvenance, pkgName) => {
        calls.push(`publish:${pkgName}:${cwd}:${distTag}:${useProvenance}`)
        return { success: true }
      },
      createAliasPlatformPackage: () => {
        throw new Error("alias explosion")
      },
      createTempDir: () => "/tmp/fake-alias-dir",
    })

    expect(outcome.pkgName).toBe("oh-my-opencode-linux-x64")
    expect(outcome.aliasPkgName).toBe("oh-my-openagent-linux-x64")
    expect(outcome.result).toEqual({ success: true })
    expect(outcome.aliasResult).toEqual({ success: false, error: "alias explosion" })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("publish:oh-my-opencode-linux-x64:")
  })

  test("continues batch processing when one platform returns an alias failure", async () => {
    const calls: string[] = []

    const results = await publishPlatformBatch(["linux-x64", "darwin-arm64"], "1.2.3", "next", {
      publishPlatformPair: async (platform) => {
        calls.push(platform)
        if (platform === "linux-x64") {
          return {
            platform,
            pkgName: "oh-my-opencode-linux-x64",
            result: { success: true },
            aliasPkgName: "oh-my-openagent-linux-x64",
            aliasResult: { success: false, error: "alias explosion" },
          }
        }

        return {
          platform,
          pkgName: "oh-my-opencode-darwin-arm64",
          result: { success: true },
          aliasPkgName: "oh-my-openagent-darwin-arm64",
          aliasResult: { success: true },
        }
      },
    })

    expect(calls).toEqual(["linux-x64", "darwin-arm64"])
    expect(results).toHaveLength(2)
    expect(results[0]?.aliasResult).toEqual({ success: false, error: "alias explosion" })
    expect(results[1]?.aliasResult).toEqual({ success: true })
  })

  test("integrates real alias generation failure handling across a batch", async () => {
    const root = createTempDir("publish-batch-")
    const packagesDir = path.join(root, "packages")
    fs.mkdirSync(packagesDir, { recursive: true })

    const writePackage = (platform: string, withBinary: boolean) => {
      const pkgDir = path.join(packagesDir, platform)
      fs.mkdirSync(path.join(pkgDir, "bin"), { recursive: true })
      fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify(
          {
            name: `oh-my-opencode-${platform}`,
            version: "1.2.3",
            description: `Platform-specific binary for oh-my-opencode (${platform})`,
            bin: { "oh-my-opencode": "./bin/oh-my-opencode" },
          },
          null,
          2
        )
      )

      if (withBinary) {
        fs.writeFileSync(path.join(pkgDir, "bin", "oh-my-opencode"), "binary")
      }
    }

    writePackage("linux-x64", false)
    writePackage("darwin-arm64", true)

    const calls: string[] = []
    const previousCwd = process.cwd()
    process.chdir(root)

    try {
      const results = await publishPlatformBatch(["linux-x64", "darwin-arm64"], "1.2.3", "next", {
        platformPublishDependencies: {
          publishPackage: async (cwd, distTag, useProvenance, pkgName) => {
            calls.push(`publish:${pkgName}:${cwd}:${distTag}:${useProvenance}`)
            return { success: true }
          },
          createAliasPlatformPackage: (sourceDir, outDir) => {
            const pkgName = JSON.parse(fs.readFileSync(path.join(sourceDir, "package.json"), "utf8")).name as string
            if (pkgName === "oh-my-opencode-linux-x64") {
              throw new Error("alias explosion")
            }

            fs.mkdirSync(outDir, { recursive: true })
            fs.writeFileSync(
              path.join(outDir, "package.json"),
              JSON.stringify({ name: "oh-my-openagent-darwin-arm64", version: "1.2.3", bin: { "oh-my-openagent": "./bin/oh-my-openagent" } }, null, 2)
            )
          },
          createTempDir: (platform) => path.join(root, `alias-${platform}`),
        },
      })

      expect(results).toHaveLength(2)
      expect(results[0]?.aliasResult).toEqual({ success: false, error: "alias explosion" })
      expect(results[1]?.aliasResult).toEqual({ success: true })
      expect(calls).toHaveLength(3)
      expect(calls[0]).toContain("publish:oh-my-opencode-linux-x64:")
      expect(calls[1]).toContain("publish:oh-my-opencode-darwin-arm64:")
      expect(calls[2]).toContain("publish:oh-my-openagent-darwin-arm64:")
    } finally {
      process.chdir(previousCwd)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
