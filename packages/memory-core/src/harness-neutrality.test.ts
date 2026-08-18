import { describe, expect, it } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const PACKAGE_ROOT = join(import.meta.dir, "..")
const FORBIDDEN_IMPORT_PATTERNS = [
  "@code-yeongyu/senpi",
  "@earendil-works/",
  "@mariozechner/pi-",
  "@oh-my-opencode/omo-senpi",
  "@oh-my-opencode/senpi-task",
]

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full))
      continue
    }
    if (full.endsWith(".ts")) files.push(full)
  }
  return files
}

describe("memory-core harness neutrality", () => {
  it("#given the package manifest #when dependencies are inspected #then no senpi or pi packages appear", () => {
    // given
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Record<string, unknown>
    // when
    const depNames = Object.keys({
      ...(manifest.dependencies as Record<string, string> | undefined),
      ...(manifest.devDependencies as Record<string, string> | undefined),
      ...(manifest.peerDependencies as Record<string, string> | undefined),
    })
    // then
    for (const dep of depNames) {
      for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
        expect(dep.startsWith(forbidden)).toBe(false)
      }
    }
  })

  it("#given every source file #when import specifiers are scanned #then no harness-coupled module is imported", () => {
    // given
    const files = collectSourceFiles(join(PACKAGE_ROOT, "src"))
    expect(files.length).toBeGreaterThan(0)
    // when / then
    for (const file of files) {
      const content = readFileSync(file, "utf8")
      for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
        expect(content.includes(`from "${forbidden}`)).toBe(false)
        expect(content.includes(`import "${forbidden}`)).toBe(false)
      }
    }
  })
})
