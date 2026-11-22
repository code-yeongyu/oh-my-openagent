import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { spawnTimeout } from "../test-support/spawn-timeout"

const packageRoot = join(import.meta.dir, "..")
const pluginRoot = join(packageRoot, "plugin")
const extensionPath = join(pluginRoot, "extensions", "omo.js")

describe("omo-senpi local-path runtime dependencies", () => {
  test("packageNameOf resolves package names from subpath imports", () => {
    expect(packageNameOf("typebox/value")).toBe("typebox")
    expect(packageNameOf("@code-yeongyu/senpi/x")).toBe("@code-yeongyu/senpi")
  })

  test("#given a symlinked plugin without host hoisting #when Node imports its runtime dependencies #then each resolves from the real path", () => {
    const externalImports = collectExternalImports(readFileSync(extensionPath, "utf8"))
    const manifest = readPackageManifest()
    const runtimePackages = collectPackageNames(manifest.dependencies)
    const peerPackages = collectPackageNames(manifest.peerDependencies)
    const runtimeImports = externalImports.filter((specifier) => !peerPackages.has(packageNameOf(specifier)))

    expect(runtimeImports.filter((specifier) => !runtimePackages.has(packageNameOf(specifier)))).toEqual([])
    expect(runtimeImports.length).toBeGreaterThan(0)

    const root = mkdtempSync(join(tmpdir(), "omo-senpi-symlink-"))
    try {
      const isolatedPackageRoot = join(root, "checkout", "packages", "omo-senpi")
      const isolatedPluginRoot = join(isolatedPackageRoot, "plugin")
      const isolatedProbePath = join(isolatedPluginRoot, "extensions", "runtime-dependency-probe.mjs")
      mkdirSync(dirname(isolatedProbePath), { recursive: true })
      writeFileSync(
        isolatedProbePath,
        `${runtimeImports.map((specifier) => `await import(${JSON.stringify(specifier)})`).join("\n")}\nconsole.log("runtime-dependencies-loaded")\n`,
      )

      for (const packageName of new Set(runtimeImports.map(packageNameOf))) {
        // The host's virtual module registry can make Bun resolve a bare name to itself.
        // Link the installed package on disk; the Node probe owns import resolution.
        const dependencyRoot = realpathSync(join(packageRoot, "node_modules", ...packageName.split("/")))
        const linkPath = join(isolatedPackageRoot, "node_modules", ...packageName.split("/"))
        mkdirSync(dirname(linkPath), { recursive: true })
        symlinkSync(dependencyRoot, linkPath, "dir")
      }

      const hostPluginPath = join(root, "host", "node_modules", "@code-yeongyu", "omo-senpi")
      mkdirSync(dirname(hostPluginPath), { recursive: true })
      symlinkSync(isolatedPluginRoot, hostPluginPath, "dir")
      expect(realpathSync(hostPluginPath)).toBe(realpathSync(isolatedPluginRoot))

      const importedExtensionUrl = pathToFileURL(
        join(hostPluginPath, "extensions", "runtime-dependency-probe.mjs"),
      ).href
      const result = spawnSync(
        "node",
        ["--input-type=module", "-e", `await import(${JSON.stringify(importedExtensionUrl)})`],
        { cwd: join(root, "host"), encoding: "utf8", timeout: spawnTimeout() },
      )

      expect(result.error).toBeUndefined()
      expect(result.stderr).toBe("")
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("runtime-dependencies-loaded")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function packageNameOf(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/")
    return parts.slice(0, 2).join("/")
  }

  return specifier.split("/")[0]
}

function collectExternalImports(source: string): string[] {
  const specifiers = new Set<string>()
  const patterns = [
    /\bimport\s*(?:[^"'()]*?\bfrom\s*)?["']([^"']+)["']/g,
    /\bexport\s*[^"'()]*?\bfrom\s*["']([^"']+)["']/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined && !specifier.startsWith("node:")) {
        specifiers.add(specifier)
      }
    }
  }

  return [...specifiers].sort()
}

function readPackageManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>
}

function collectPackageNames(value: unknown): Set<string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return new Set()
  return new Set(Object.keys(value))
}
