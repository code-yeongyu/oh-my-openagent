import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const adapterManifestPath = join(repoRoot, "packages", "omo-omp", "package.json")
const pluginManifestPath = join(repoRoot, "packages", "omo-omp", "plugin", "package.json")

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

describe("OMO OMP plugin manifest", () => {
  it("#given an OMP plugin package manifest #when loaded #then it points at exactly one bundled extension and skills directory", () => {
    const manifest = readJsonObject(pluginManifestPath)
    const omp = manifest.omp

    expect(omp).toBeObject()
    if (typeof omp !== "object" || omp === null || Array.isArray(omp)) {
      throw new Error("plugin package.json omp manifest is not an object")
    }

    expect(Reflect.get(omp, "extensions")).toEqual(["./extensions/omo.js"])
    expect(Reflect.get(omp, "skills")).toEqual(["./skills"])
    expect(Reflect.has(omp, "hooks")).toBe(false)
  })

  it("#given the OMP package is one generated runtime unit #when loaded #then npm dependency and workspace surfaces stay absent", () => {
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

  it("#given package metadata #when loaded #then OMP discoverability and shipped files are pinned", () => {
    const manifest = readJsonObject(pluginManifestPath)

    expect(manifest.name).toBe("@code-yeongyu/omo-omp")
    expect(manifest.type).toBe("module")
    expect(manifest.keywords).toContain("omp")
    expect(manifest.keywords).toContain("oh-my-pi")
    expect(manifest.keywords).toContain("omo")
    expect(manifest.keywords).toContain("oh-my-openagent")
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
