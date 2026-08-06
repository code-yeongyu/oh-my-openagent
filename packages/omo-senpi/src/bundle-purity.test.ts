import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { SENPI_LOADER_ALIASES } from "../plugin/scripts/build-extension.mjs"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const builtExtensionPath = join(packageRoot, "plugin", "extensions", "omo.js")

const EXPECTED_SENPI_LOADER_ALIASES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/oauth",
  "@code-yeongyu/senpi",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-tui",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-ai/compat",
  "@mariozechner/pi-ai/oauth",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
] as const

describe("omo-senpi bundle purity", () => {
  it("#given the senpi loader aliases #when tested #then the shared build constant pins all 19 peers", () => {
    expect(SENPI_LOADER_ALIASES).toEqual([...EXPECTED_SENPI_LOADER_ALIASES])
  })

  it("#given a built extension #when static imports are inspected #then only senpi peers and node builtins remain external", () => {
    expect(existsSync(builtExtensionPath), `missing built extension at ${builtExtensionPath}`).toBe(true)

    const source = readFileSync(builtExtensionPath, "utf8")
    const imports = collectStaticImportSpecifiers(source)
    const allowed = new Set<string>(SENPI_LOADER_ALIASES)
    const forbidden = imports.filter((specifier) => !specifier.startsWith("node:") && !allowed.has(specifier))

    expect(forbidden).toEqual([])
  })
})

function collectStaticImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  // Whitespace-tolerant so the minified bundle shape (`import{x}from"y"`, `import"y"`, `export*from"y"`)
  // is scanned exactly like the spaced shape - otherwise the guard would pass vacuously on minified output.
  const patterns = [
    /\bimport\s*(?:[^"'()]*?\bfrom\s*)?["']([^"']+)["']/g,
    /\bexport\s*[^"'()]*?\bfrom\s*["']([^"']+)["']/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) {
        specifiers.add(match[1])
      }
    }
  }

  return [...specifiers].sort()
}
