import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The Anthropic native tool-search contract (`tool_search_tool_bm25_20251119`, the
 * `defer_loading` / `tool_reference` payload transform) is owned exclusively by the
 * pinned engine, in `@code-yeongyu/senpi` `dist/core/extensions/builtin/tool-search/`.
 *
 * omo-ai ships a byte-rewriting postinstall (`bin/senpi-patch.mjs`) that edits files
 * inside that installed engine, so this package is one edit away from carrying its own
 * copy of the wire contract. A second copy would silently diverge from the engine on
 * the next Anthropic revision and pin the beta channel to a stale tool type.
 *
 * These assertions guard one machine-consumed value: the exact wire token the API
 * dispatches on. The dependency pin itself is owned by `senpi-pin.test.ts`, which
 * holds the single `SENPI_PIN` constant every release bump updates; re-asserting a
 * version literal here would add a second place to update and go red on any bump.
 */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

/** The engine-owned Anthropic wire tokens this package must never re-declare. */
const ENGINE_OWNED_TOOL_SEARCH_TOKENS = [
  "tool_search_tool_bm25_20251119",
  "defer_loading",
  "tool_reference",
] as const

/**
 * `files` is `["bin", "plugin"]`; `plugin/` is a gitignored build artifact staged by
 * `bun run build:omo-native`, so `bin/` is the whole committed publish surface.
 */
function shippedSourceFiles(): string[] {
  const collected: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else collected.push(path)
    }
  }
  walk(join(PACKAGE_ROOT, "bin"))
  return collected
}

describe("anthropic tool-search compatibility", () => {
  describe("#given the committed omo-ai publish surface", () => {
    describe("#when every shipped file is scanned for engine-owned tool-search tokens", () => {
      test("#then the scan reads the real launcher sources", () => {
        const files = shippedSourceFiles()
        expect(files).toContain(join(PACKAGE_ROOT, "bin", "senpi-patch.mjs"))
        expect(files).toContain(join(PACKAGE_ROOT, "bin", "omo.js"))
      })

      test("#then no shipped file re-declares the Anthropic native tool-search contract", () => {
        const offenders = shippedSourceFiles().flatMap((path) => {
          const source = readFileSync(path, "utf8")
          return ENGINE_OWNED_TOOL_SEARCH_TOKENS.filter((token) => source.includes(token)).map(
            (token) => `${path.slice(PACKAGE_ROOT.length + 1)}: ${token}`,
          )
        })
        expect(offenders).toEqual([])
      })
    })
  })
})
