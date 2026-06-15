import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")

function readJson(path: string): { readonly version?: unknown } {
  return JSON.parse(readFileSync(path, "utf8")) as { readonly version?: unknown }
}

function rootVersion(): string {
  const version = readJson(join(repoRoot, "package.json")).version
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error("root package.json has no usable version")
  }
  return version
}

function pluginWorkspaceManifests(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"))
  const workspaces = typeof manifest === "object" && manifest !== null
    ? Reflect.get(manifest, "workspaces")
    : undefined

  if (!Array.isArray(workspaces)) {
    throw new Error("Codex plugin package.json has no workspaces array")
  }

  return workspaces
    .filter((workspace): workspace is string => workspace.startsWith("components/"))
    .map((workspace) => join(pluginRoot, workspace, "package.json"))
}

function componentManifests(): string[] {
  return pluginWorkspaceManifests()
}

function versionedManifests(): string[] {
  return [
    join(repoRoot, "packages", "omo-codex", "package.json"),
    join(pluginRoot, "package.json"),
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    ...componentManifests(),
  ]
}

describe("OMO Codex version coherence", () => {
  // The Codex plugin bundle ships its own version to the Codex marketplace and
  // app UI. If any manifest drifts from the single source of truth (root
  // package.json) a release can leak a placeholder version like 0.1.0, which is
  // exactly the confusion this guard exists to prevent.
  it("#given every versioned Codex manifest #when compared to root package.json #then versions match", () => {
    // given
    const expected = rootVersion()

    // when / then
    for (const manifest of versionedManifests()) {
      const actual = readJson(manifest).version
      expect(`${relative(repoRoot, manifest)} -> ${String(actual)}`).toBe(`${relative(repoRoot, manifest)} -> ${expected}`)
    }
  })

  it("#given no manifest is missing a version #when checking versioned manifests #then each declares a string version", () => {
    // when / then
    for (const manifest of versionedManifests()) {
      expect(typeof readJson(manifest).version).toBe("string")
    }
  })

  it("#given every committed hooks.json #when scanning LazyCodex status messages #then none carry a stale version label", () => {
    // given
    const expected = rootVersion()
    const hookManifests = [
      join(pluginRoot, "hooks", "hooks.json"),
      ...pluginWorkspaceManifests().map((manifest) =>
        join(manifest, "..", "hooks", "hooks.json"),
      ),
    ]

    // when / then
    for (const manifest of hookManifests) {
      let raw: string
      try {
        raw = readFileSync(manifest, "utf8")
      } catch {
        continue
      }
      const labels = [...raw.matchAll(/LazyCodex\(([^)]*)\):/g)].map((match) => match[1])
      for (const label of labels) {
        expect(`${relative(repoRoot, manifest)} -> LazyCodex(${label})`).toBe(`${relative(repoRoot, manifest)} -> LazyCodex(${expected})`)
      }
    }
  })
})
