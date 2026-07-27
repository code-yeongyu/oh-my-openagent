import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"

const PACKAGE_PATH = join(import.meta.dir, "..", "..", "package.json")
const ENTRY_POINT = join(import.meta.dir, "index.ts")
const CONFIG_CORE_ENTRY_POINT = join(import.meta.dir, "..", "..", "..", "..", "packages", "omo-config-core", "src", "index.ts")
const OPENCODE_IMPORT = /^@opencode-ai\//
const PLUGIN_RUNTIME_DIRECTORY = `${sep}plugin${sep}`
const PLUGIN_CONFIG_DIRECTORY = `${sep}plugin-config${sep}`

function importSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  const expression = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const match of source.matchAll(expression)) {
    const specifier = match[1] ?? match[2]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}

function resolveRelativeImport(sourcePath: string, specifier: string): string {
  const base = resolve(dirname(sourcePath), specifier)
  const candidates = [`${base}.ts`, join(base, "index.ts")]
  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (resolved === undefined) throw new Error(`Cannot resolve ${specifier} from ${sourcePath}`)
  return resolved
}

function moduleGraph(entryPoint: string): readonly string[] {
  const pending = [entryPoint]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    for (const specifier of importSpecifiers(readFileSync(current, "utf-8"))) {
      if (specifier.startsWith(".")) pending.push(resolveRelativeImport(current, specifier))
      if (specifier === "@oh-my-opencode/omo-config-core") pending.push(CONFIG_CORE_ENTRY_POINT)
    }
  }
  return [...visited]
}

describe("config-migration public subpath", () => {
  test("#given the package manifest #when resolving config-migration #then its dedicated public subpath points only at the dependency-clean module", () => {
    // given
    const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf-8")) as Record<string, unknown>

    // when
    const exports = packageJson.exports

    // then
    expect(exports).toEqual({
      "./config-migration": {
        import: "./src/config-migration/index.ts",
        types: "./src/config-migration/index.ts",
      },
    })
  })

  test("#given the config-migration entry point #when its local module graph is audited #then it imports neither OpenCode SDK modules nor plugin runtime code", () => {
    // given
    const modules = moduleGraph(ENTRY_POINT)
    const offenders: string[] = []

    // when
    for (const modulePath of modules) {
      const source = readFileSync(modulePath, "utf-8")
      for (const specifier of importSpecifiers(source)) {
        if (OPENCODE_IMPORT.test(specifier)) offenders.push(`${modulePath} imports ${specifier}`)
      }
      if (modulePath.includes(PLUGIN_RUNTIME_DIRECTORY) || modulePath.includes(PLUGIN_CONFIG_DIRECTORY)) {
        offenders.push(`${modulePath} is plugin runtime code`)
      }
    }

    // then
    expect(modules).toContain(CONFIG_CORE_ENTRY_POINT)
    expect(offenders).toEqual([])
  })
})
