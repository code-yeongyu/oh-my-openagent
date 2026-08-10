import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"

// The senpi extension bundle is loaded by senpi under plain Node through jiti, where the Bun-only
// module-location properties import.meta.dir and import.meta.file evaluate to undefined. One such use
// at module scope (memory-core reflection assets) killed the whole extension at load time in the
// published v5.0.0-beta.1 artifact.
const PACKAGE_ROOT = resolve(import.meta.dir, "..")
const BUNDLE_INPUT_SOURCES = [
  "omo-senpi/src",
  "memory-core/src",
  "senpi-task/src",
  "omo-config-core/src",
  "delegate-core/src",
  "team-core/src",
  "boulder-state/src",
  "comment-checker-core/src",
  "telemetry-core/src",
  "prompts-core/src",
  "lsp-core/src",
  "utils/src",
].map((entry) => resolve(PACKAGE_ROOT, "..", entry))

const BUN_ONLY_MODULE_LOCATION = /import\.meta\.(?:dir|file)\b/

function shippedTypescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) return shippedTypescriptFiles(path)
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return []
    if (entry.name.endsWith(".test.ts") || entry.name.includes(".test-support.")) return []
    return [path]
  })
}

test("#given shipped extension sources #when scanned for Bun-only module-location APIs #then none appear", () => {
  const offenders = BUNDLE_INPUT_SOURCES.flatMap((root) =>
    shippedTypescriptFiles(root).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => {
          const trimmed = line.trimStart()
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false
          return BUN_ONLY_MODULE_LOCATION.test(line)
        })
        .map(({ line, lineNumber }) => `${relative(root, path)}:${lineNumber}:${line.trim()}`),
    ),
  )

  expect(offenders).toEqual([])
})
