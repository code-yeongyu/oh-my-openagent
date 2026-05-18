/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { createAliasMainPackage } from "./alias-main-package"

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.env.HOME ?? process.cwd(), "tmp")
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

interface AliasMainFixtureOptions {
  packageJson: Record<string, unknown>
  indexJsContent?: string
  cliIndexJsContent?: string
  includeWrapper?: boolean
}

function writeAliasMainFixture(sourceRoot: string, options: AliasMainFixtureOptions): void {
  fs.mkdirSync(path.join(sourceRoot, "dist", "cli"), { recursive: true })
  fs.mkdirSync(path.join(sourceRoot, "dist", "hooks", "auto-update-checker"), { recursive: true })
  fs.mkdirSync(path.join(sourceRoot, "bin"), { recursive: true })

  fs.writeFileSync(
    path.join(sourceRoot, "package.json"),
    `${JSON.stringify(options.packageJson, null, 2)}\n`
  )
  fs.writeFileSync(path.join(sourceRoot, "bin", "platform.js"), 'return "oh-my-opencode-linux-x64/bin/oh-my-opencode";')
  if (options.includeWrapper !== false) {
    fs.writeFileSync(path.join(sourceRoot, "bin", "oh-my-opencode.js"), 'console.log("oh-my-opencode")')
  }
  fs.writeFileSync(path.join(sourceRoot, "postinstall.mjs"), 'console.log("oh-my-opencode")')
  fs.writeFileSync(
    path.join(sourceRoot, "dist", "index.js"),
    options.indexJsContent ?? 'var PACKAGE_NAME = "oh-my-opencode";'
  )
  fs.writeFileSync(
    path.join(sourceRoot, "dist", "cli", "index.js"),
    options.cliIndexJsContent ?? 'var PACKAGE_NAME2 = "oh-my-opencode", NPM_REGISTRY_URL;'
  )
  fs.writeFileSync(
    path.join(sourceRoot, "dist", "hooks", "auto-update-checker", "constants.d.ts"),
    [
      'export declare const PACKAGE_NAME = "oh-my-opencode";',
      'export declare const NPM_REGISTRY_URL = "https://registry.npmjs.org/-/package/oh-my-opencode/dist-tags";',
    ].join("\n")
  )
  fs.writeFileSync(path.join(sourceRoot, "dist", "oh-my-opencode.schema.json"), "{}")
}

const cleanupPaths: string[] = []

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

describe("createAliasMainPackage", () => {
  it("rewrites alias publish metadata without mutating the source package", () => {
    const sourceRoot = createTempDir("omo-source-")
    const outDir = createTempDir("omo-out-")
    cleanupPaths.push(sourceRoot, outDir)

    writeAliasMainFixture(sourceRoot, {
      packageJson: {
        name: "oh-my-opencode",
        version: "3.16.0",
        bin: { "oh-my-opencode": "bin/oh-my-opencode.js" },
        exports: { "./schema.json": "./dist/oh-my-opencode.schema.json" },
        optionalDependencies: {
          "oh-my-opencode-linux-x64": "3.16.0",
          "oh-my-opencode-windows-x64": "3.16.0",
        },
      },
    })

    createAliasMainPackage(sourceRoot, outDir)

    const generatedPackage = JSON.parse(
      fs.readFileSync(path.join(outDir, "package.json"), "utf-8")
    ) as {
      name: string
      bin: Record<string, string>
      exports: Record<string, string>
      optionalDependencies: Record<string, string>
      scripts?: Record<string, string>
    }

    expect(generatedPackage.name).toBe("oh-my-openagent")
    expect(generatedPackage.bin).toEqual({ "oh-my-openagent": "bin/oh-my-openagent.js" })
    expect(generatedPackage.exports["./schema.json"]).toBe("./dist/oh-my-openagent.schema.json")
    expect(Object.keys(generatedPackage.optionalDependencies)).toEqual([
      "oh-my-openagent-linux-x64",
      "oh-my-openagent-windows-x64",
    ])
    expect(generatedPackage.scripts).toBeUndefined()

    expect(fs.existsSync(path.join(outDir, "bin", "oh-my-openagent.js"))).toBe(true)
    expect(fs.existsSync(path.join(outDir, "bin", "oh-my-opencode.js"))).toBe(false)
    expect(fs.existsSync(path.join(outDir, "dist", "oh-my-openagent.schema.json"))).toBe(true)
    expect(fs.existsSync(path.join(outDir, "dist", "oh-my-opencode.schema.json"))).toBe(false)

    expect(fs.readFileSync(path.join(outDir, "bin", "platform.js"), "utf-8")).toContain("oh-my-openagent")
    expect(fs.readFileSync(path.join(outDir, "dist", "index.js"), "utf-8")).toContain('var PACKAGE_NAME = "oh-my-openagent";')
    expect(fs.readFileSync(path.join(outDir, "dist", "cli", "index.js"), "utf-8")).toContain('var PACKAGE_NAME2 = "oh-my-openagent",')

    const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf-8")) as {
      name: string
    }
    expect(sourcePackage.name).toBe("oh-my-opencode")
  })

  it("can override alias package version and dependency versions", () => {
    const sourceRoot = createTempDir("omo-source-version-")
    const outDir = createTempDir("omo-out-version-")
    cleanupPaths.push(sourceRoot, outDir)

    writeAliasMainFixture(sourceRoot, {
      packageJson: {
        name: "oh-my-opencode",
        version: "3.15.0",
        bin: { "oh-my-opencode": "bin/oh-my-opencode.js" },
        exports: { "./schema.json": "./dist/oh-my-opencode.schema.json" },
        optionalDependencies: {
          "oh-my-opencode-linux-x64": "3.15.0",
          "oh-my-opencode-windows-x64": "3.15.0",
        },
      },
    })

    createAliasMainPackage(sourceRoot, outDir, { version: "3.16.0-alpha-1" })

    const generatedPackage = JSON.parse(
      fs.readFileSync(path.join(outDir, "package.json"), "utf-8")
    ) as {
      version: string
      optionalDependencies: Record<string, string>
    }

    expect(generatedPackage.version).toBe("3.16.0-alpha-1")
    expect(generatedPackage.optionalDependencies).toEqual({
      "oh-my-openagent-linux-x64": "3.16.0-alpha-1",
      "oh-my-openagent-windows-x64": "3.16.0-alpha-1",
    })
  })

  it("removes prepare and prepublishOnly from the generated alias manifest", () => {
    const sourceRoot = createTempDir("omo-source-scripts-")
    const outDir = createTempDir("omo-out-scripts-")
    cleanupPaths.push(sourceRoot, outDir)

    writeAliasMainFixture(sourceRoot, {
      packageJson: {
        name: "oh-my-opencode",
        version: "3.16.0",
        bin: { "oh-my-opencode": "bin/oh-my-opencode.js" },
        exports: { "./schema.json": "./dist/oh-my-opencode.schema.json" },
        scripts: {
          prepare: "bun run build",
          prepublishOnly: "bun run clean && bun run build",
          postinstall: "node postinstall.mjs",
        },
      },
      cliIndexJsContent: 'var PACKAGE_NAME2 = "oh-my-opencode";',
    })

    createAliasMainPackage(sourceRoot, outDir)

    const generatedPackage = JSON.parse(
      fs.readFileSync(path.join(outDir, "package.json"), "utf-8")
    ) as {
      scripts?: Record<string, string>
    }

    expect(generatedPackage.scripts).toEqual({
      postinstall: "node postinstall.mjs",
    })
  })

  it("fails loudly when a required runtime rewrite target is missing", () => {
    const sourceRoot = createTempDir("omo-source-missing-")
    const outDir = createTempDir("omo-out-missing-")
    cleanupPaths.push(sourceRoot, outDir)

    writeAliasMainFixture(sourceRoot, {
      packageJson: {
        name: "oh-my-opencode",
        version: "3.16.0",
        bin: { "oh-my-opencode": "bin/oh-my-opencode.js" },
        exports: { "./schema.json": "./dist/oh-my-opencode.schema.json" },
      },
      indexJsContent: 'var PACKAGE_NAME = "different-name";',
    })

    expect(() => createAliasMainPackage(sourceRoot, outDir)).toThrow("Expected to find")
  })

  it("fails when the canonical CLI wrapper is missing", () => {
    const sourceRoot = createTempDir("omo-source-no-wrapper-")
    const outDir = createTempDir("omo-out-no-wrapper-")
    cleanupPaths.push(sourceRoot, outDir)

    writeAliasMainFixture(sourceRoot, {
      packageJson: {
        name: "oh-my-opencode",
        version: "3.16.0",
        bin: { "oh-my-opencode": "bin/oh-my-opencode.js" },
        exports: { "./schema.json": "./dist/oh-my-opencode.schema.json" },
      },
      includeWrapper: false,
    })

    expect(() => createAliasMainPackage(sourceRoot, outDir)).toThrow("Expected canonical wrapper")
  })

  it("works against the real current built artifact shape", () => {
    const repoRoot = path.resolve(import.meta.dir, "../..")
    const outDir = createTempDir("omo-real-artifact-")
    cleanupPaths.push(outDir)

    createAliasMainPackage(repoRoot, outDir, { version: "9.9.9-alpha-1" })

    const generatedPackage = JSON.parse(
      fs.readFileSync(path.join(outDir, "package.json"), "utf-8")
    ) as {
      name: string
      version: string
      scripts?: Record<string, string>
      optionalDependencies: Record<string, string>
    }

    expect(generatedPackage.name).toBe("oh-my-openagent")
    expect(generatedPackage.version).toBe("9.9.9-alpha-1")
    expect(generatedPackage.scripts?.prepare).toBeUndefined()
    expect(generatedPackage.scripts?.prepublishOnly).toBeUndefined()
    expect(generatedPackage.scripts?.postinstall).toBe("node postinstall.mjs")
    expect(generatedPackage.optionalDependencies["oh-my-openagent-linux-x64"]).toBe("9.9.9-alpha-1")

    expect(fs.readFileSync(path.join(outDir, "dist", "index.js"), "utf-8")).toContain('var PACKAGE_NAME = "oh-my-openagent";')
    expect(fs.readFileSync(path.join(outDir, "dist", "cli", "index.js"), "utf-8")).toContain('var PACKAGE_NAME2 = "oh-my-openagent"')
  })

  it("can be packed by npm from the generated temp artifact directory", () => {
    const repoRoot = path.resolve(import.meta.dir, "../..")
    const outDir = createTempDir("omo-real-pack-")
    cleanupPaths.push(outDir)

    createAliasMainPackage(repoRoot, outDir, { version: "9.9.9-alpha-1" })

    const packedFile = execFileSync("npm", ["pack", outDir], {
      cwd: outDir,
      encoding: "utf8",
    }).trim()

    expect(packedFile).toBe("oh-my-openagent-9.9.9-alpha-1.tgz")
    expect(fs.existsSync(path.join(outDir, packedFile))).toBe(true)
  })
})
