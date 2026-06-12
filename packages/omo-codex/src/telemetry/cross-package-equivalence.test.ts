import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "../../..", "..")
const CODEX_ROOT = join(REPO_ROOT, "packages", "omo-codex")
const COMPONENT_ROOT = join(CODEX_ROOT, "plugin", "components", "telemetry")
const REMOVED_SYNC_SCRIPT_NAME = ["sync", "telemetry", "component"].join("-")
const TELEMETRY_CORE_PACKAGE = "@oh-my-opencode/telemetry-core"
const SYNCED_COMPONENT_SOURCE_PATTERN =
  /(atomic-write|data-path|diagnostics|env-flags|posthog-activity-state)\.ts$/

function readText(path: string): string {
  return readFileSync(path, "utf-8")
}

function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(readText(path))
  return parsed
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object while reading ${key}`)
  }
  return Reflect.get(value, key)
}

function collectFiles(root: string, relativePrefix = ""): string[] {
  const files: string[] = []
  for (const entry of readdirSync(join(root, relativePrefix), { withFileTypes: true })) {
    const relativePath = join(relativePrefix, entry.name)
    const fullPath = join(root, relativePath)
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, relativePath))
    } else if (statSync(fullPath).isFile()) {
      files.push(relativePath)
    }
  }
  return files
}

describe("omo-codex telemetry single-source guard", () => {
  describe("#given the omo-codex package tree", () => {
    it("#when sync-copy references are searched #then no telemetry sync script or build hook remains", () => {
      const files = collectFiles(CODEX_ROOT).filter((file) => !file.includes("node_modules/"))
      const offenders: string[] = []

      for (const file of files) {
        const fullPath = join(CODEX_ROOT, file)
        if (file.endsWith(".png") || file.endsWith(".ico")) {
          continue
        }
        const content = readText(fullPath)
        if (content.includes(REMOVED_SYNC_SCRIPT_NAME)) {
          offenders.push(file)
        }
      }

      expect(offenders).toEqual([])
    })
  })

  describe("#given the Codex telemetry component sources and package manifest", () => {
    it("#when inspected #then the component consumes telemetry-core instead of committed synced sources", () => {
      const componentPackageJson = readJson(join(COMPONENT_ROOT, "package.json"))
      const devDependencies = getObjectProperty(componentPackageJson, "devDependencies")
      const srcFiles = collectFiles(join(COMPONENT_ROOT, "src"))

      expect(devDependencies).toMatchObject({
        [TELEMETRY_CORE_PACKAGE]: "file:../../../../telemetry-core",
      })
      expect(srcFiles.filter((file) => SYNCED_COMPONENT_SOURCE_PATTERN.test(file))).toEqual([])
      expect(readText(join(COMPONENT_ROOT, "src", "posthog.ts"))).toContain(TELEMETRY_CORE_PACKAGE)
    })
  })

  describe("#given the built telemetry component bundle", () => {
    it("#when inspected #then telemetry-core is bundled self-contained into the runtime CLI", () => {
      const bundlePath = join(COMPONENT_ROOT, "dist", "cli.js")

      expect(existsSync(bundlePath)).toBe(true)
      const bundle = readText(bundlePath)

      expect(bundle).not.toContain(`from "${TELEMETRY_CORE_PACKAGE}"`)
      expect(bundle).not.toContain(`import("${TELEMETRY_CORE_PACKAGE}")`)
      expect(bundle).toContain("omo_codex_daily_active")
      expect(bundle).toContain("omo-codex:")
      expect(bundle).toContain("posthog-activity.json")
    })
  })
})
