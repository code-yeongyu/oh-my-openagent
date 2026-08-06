import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))

type ScriptTsconfig = {
  readonly include: readonly string[]
}

type PackageManifest = {
  readonly scripts: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function parseScriptTsconfig(configText: string): ScriptTsconfig {
  const config: unknown = JSON.parse(configText)
  if (!isRecord(config)) {
    return { include: [] }
  }

  return { include: parseStringArray(config.include) }
}

function parsePackageManifest(configText: string): PackageManifest {
  const manifest: unknown = JSON.parse(configText)
  if (!isRecord(manifest)) {
    return { scripts: {} }
  }

  return { scripts: parseStringRecord(manifest.scripts) }
}

function toPackagePath(filePath: string): string {
  return relative(repositoryRoot, filePath).split(sep).join("/")
}

describe("script TypeScript project", () => {
  test("#given script TypeScript files #when checking script tsconfig #then every top-level script file is included by the project", () => {
    // given
    const scriptRoot = join(repositoryRoot, "script")
    const scriptFiles = readdirSync(scriptRoot)
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => `./${entry}`)
      .sort()
    const scriptTsconfig = parseScriptTsconfig(readFileSync(join(scriptRoot, "tsconfig.json"), "utf8"))

    // when
    const missingFiles = scriptFiles.filter((scriptFile) => (
      !scriptTsconfig.include.includes("./*.ts") && !scriptTsconfig.include.includes(scriptFile)
    ))

    // then
    expect(scriptFiles).toContain("./build-binaries.ts")
    expect(scriptFiles).toContain("./build-binaries.test.ts")
    expect(scriptFiles).toContain("./build-schema.test.ts")
    expect(missingFiles).toEqual([])
  })

  test("#given root typecheck #when checking package scripts #then script typecheck is part of the root gate", () => {
    // given
    const manifestPath = join(repositoryRoot, "package.json")
    const manifest = parsePackageManifest(readFileSync(manifestPath, "utf8"))

    // when
    const typecheck = manifest.scripts.typecheck ?? ""
    const scriptTypecheck = manifest.scripts["typecheck:script"] ?? ""

    // then
    expect(toPackagePath(manifestPath)).toBe("package.json")
    expect(scriptTypecheck).toBe("tsgo --noEmit -p script/tsconfig.json")
    expect(typecheck).toContain("bun run typecheck:script")
  })
})
