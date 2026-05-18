/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { createAliasPlatformPackage } from "./alias-platform-package"

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.env.HOME ?? process.cwd(), "tmp")
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

const cleanupPaths: string[] = []

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

describe("createAliasPlatformPackage", () => {
  it("rewrites platform package metadata and binary name for alias publish", () => {
    const sourceDir = createTempDir("omo-platform-source-")
    const outDir = createTempDir("omo-platform-out-")
    cleanupPaths.push(sourceDir, outDir)

    fs.mkdirSync(path.join(sourceDir, "bin"), { recursive: true })
    fs.writeFileSync(
      path.join(sourceDir, "package.json"),
      `${JSON.stringify(
        {
          name: "oh-my-opencode-linux-x64",
          version: "3.16.0",
          description: "Platform-specific binary for oh-my-opencode (linux-x64)",
          bin: { "oh-my-opencode": "./bin/oh-my-opencode" },
        },
        null,
        2
      )}\n`
    )
    fs.writeFileSync(path.join(sourceDir, "bin", "oh-my-opencode"), "binary")

    createAliasPlatformPackage(sourceDir, outDir)

    const generatedPackage = JSON.parse(
      fs.readFileSync(path.join(outDir, "package.json"), "utf-8")
    ) as {
      name: string
      description: string
      bin: Record<string, string>
    }

    expect(generatedPackage.name).toBe("oh-my-openagent-linux-x64")
    expect(generatedPackage.description).toBe("Platform-specific binary for oh-my-openagent (linux-x64)")
    expect(generatedPackage.bin).toEqual({ "oh-my-openagent": "./bin/oh-my-openagent" })

    expect(fs.existsSync(path.join(outDir, "bin", "oh-my-openagent"))).toBe(true)
    expect(fs.existsSync(path.join(outDir, "bin", "oh-my-opencode"))).toBe(false)
  })

  it("fails when the declared platform binary is missing", () => {
    const sourceDir = createTempDir("omo-platform-missing-")
    const outDir = createTempDir("omo-platform-out-missing-")
    cleanupPaths.push(sourceDir, outDir)

    fs.mkdirSync(path.join(sourceDir, "bin"), { recursive: true })
    fs.writeFileSync(
      path.join(sourceDir, "package.json"),
      `${JSON.stringify(
        {
          name: "oh-my-opencode-linux-x64",
          version: "3.16.0",
          description: "Platform-specific binary for oh-my-opencode (linux-x64)",
          bin: { "oh-my-opencode": "./bin/oh-my-opencode" },
        },
        null,
        2
      )}\n`
    )

    expect(() => createAliasPlatformPackage(sourceDir, outDir)).toThrow("Expected platform binary")
  })

  it("rejects bin paths that escape the output directory", () => {
    const sourceDir = createTempDir("omo-platform-escape-")
    const outDir = createTempDir("omo-platform-out-escape-")
    cleanupPaths.push(sourceDir, outDir)

    fs.mkdirSync(path.join(sourceDir, "bin"), { recursive: true })
    fs.writeFileSync(
      path.join(sourceDir, "package.json"),
      `${JSON.stringify(
        {
          name: "oh-my-opencode-linux-x64",
          version: "3.16.0",
          description: "Platform-specific binary for oh-my-opencode (linux-x64)",
          bin: { "oh-my-opencode": "../outside/oh-my-opencode" },
        },
        null,
        2
      )}\n`
    )

    expect(() => createAliasPlatformPackage(sourceDir, outDir)).toThrow("Expected path within")
  })

  it("handles the real linux-x64 package manifest shape", () => {
    const sourceDir = createTempDir("omo-platform-real-shape-")
    const outDir = createTempDir("omo-platform-real-shape-out-")
    cleanupPaths.push(sourceDir, outDir)

    const repoRoot = path.resolve(import.meta.dir, "../..")
    const realPackageJsonPath = path.join(repoRoot, "packages", "linux-x64", "package.json")
    const realPackageJson = JSON.parse(fs.readFileSync(realPackageJsonPath, "utf-8")) as {
      name: string
      version: string
      description?: string
      bin: Record<string, string>
    }

    fs.mkdirSync(path.join(sourceDir, "bin"), { recursive: true })
    fs.writeFileSync(
      path.join(sourceDir, "package.json"),
      `${JSON.stringify(realPackageJson, null, 2)}\n`
    )

    const declaredBinary = Object.values(realPackageJson.bin)[0]
    if (!declaredBinary) {
      throw new Error("Expected real package manifest to declare a binary")
    }

    const binaryRelativePath = declaredBinary.replace(/^\.\//, "")
    const binaryPath = path.join(sourceDir, binaryRelativePath)
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, "binary")

    createAliasPlatformPackage(sourceDir, outDir)

    const generatedPackage = JSON.parse(
      fs.readFileSync(path.join(outDir, "package.json"), "utf-8")
    ) as {
      name: string
      version: string
      bin: Record<string, string>
    }

    expect(generatedPackage.name).toBe("oh-my-openagent-linux-x64")
    expect(generatedPackage.version).toBe(realPackageJson.version)
    expect(generatedPackage.bin).toEqual({
      "oh-my-openagent": "./bin/oh-my-openagent",
    })
    expect(fs.existsSync(path.join(outDir, "bin", "oh-my-openagent"))).toBe(true)
  })
})
