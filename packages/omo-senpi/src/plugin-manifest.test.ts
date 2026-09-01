import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const adapterManifestPath = join(repoRoot, "packages", "omo-senpi", "package.json")
const pluginManifestPath = join(repoRoot, "packages", "omo-senpi", "plugin", "package.json")

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJsonObject(path: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isJsonObject(value)) {
    throw new Error(`${relative(repoRoot, path)} is not a JSON object`)
  }
  return value
}

function stringField(manifest: JsonObject, path: string, field: string): string {
  const value = manifest[field]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${relative(repoRoot, path)} has no usable ${field}`)
  }
  return value
}

function rootVersion(): string {
  return stringField(readJsonObject(join(repoRoot, "package.json")), join(repoRoot, "package.json"), "version")
}

function adapterVersionIfPresent(): string | undefined {
  if (!existsSync(adapterManifestPath)) {
    return undefined
  }
  return stringField(readJsonObject(adapterManifestPath), adapterManifestPath, "version")
}

describe("OMO Senpi plugin manifest", () => {
  it("#given a Pi package manifest #when loaded #then it points at exactly one bundled extension and skills directory", () => {
    const manifest = readJsonObject(pluginManifestPath)
    const pi = manifest.pi

    expect(pi).toBeObject()
    if (typeof pi !== "object" || pi === null || Array.isArray(pi)) {
      throw new Error("plugin package.json pi manifest is not an object")
    }

    expect(Reflect.get(pi, "extensions")).toEqual(["./extensions/omo.js"])
    expect(Reflect.get(pi, "skills")).toEqual(["./skills"])
    expect(Reflect.has(pi, "hooks")).toBe(false)
  })

  it("#given the Senpi package is one generated runtime unit #when loaded #then npm dependency and workspace surfaces stay absent", () => {
    const manifest = readJsonObject(pluginManifestPath)
    const dependencies = manifest.dependencies

    expect(dependencies === undefined || (
      typeof dependencies === "object"
      && dependencies !== null
      && !Array.isArray(dependencies)
      && Object.keys(dependencies).length === 0
    )).toBe(true)
    expect(Reflect.has(manifest, "workspaces")).toBe(false)
  })

  it("#given package metadata #when loaded #then Pi discoverability and shipped files are pinned", () => {
    const manifest = readJsonObject(pluginManifestPath)

    expect(manifest.name).toBe("@code-yeongyu/omo-senpi")
    expect(manifest.type).toBe("module")
    expect(manifest.keywords).toContain("pi-package")
    expect(manifest.keywords).toContain("senpi")
    expect(manifest.keywords).toContain("omo")
    expect(manifest.keywords).toContain("oh-my-openagent")
    expect(manifest.keywords).toContain("pi")
    expect(manifest.files).toEqual(["extensions", "skills", "runtime", "scripts/install.mjs", "README.md", "NOTICE", "LICENSE"])
  })

  it("#given root and adapter versions #when compared #then the plugin manifest stays in lockstep", () => {
    const pluginVersion = stringField(readJsonObject(pluginManifestPath), pluginManifestPath, "version")
    const expectedRootVersion = rootVersion()

    expect(pluginVersion).toBe(expectedRootVersion)

    const adapterVersion = adapterVersionIfPresent()
    if (adapterVersion !== undefined) {
      expect(pluginVersion).toBe(adapterVersion)
    }
  })
})
