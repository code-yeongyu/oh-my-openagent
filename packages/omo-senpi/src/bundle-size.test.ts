import { describe, expect, it } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const builtExtensionPath = join(packageRoot, "plugin", "extensions", "omo.js")

// PLAN TARGET (todo 17e): the built omo.js must stay at or under 700,000 bytes.
//
// The extension inlines every component's third-party dependency tree into ONE non-split file
// (zod v4 ~477 KB, jsonc-parser ~263 KB, posthog-node ~175 KB, js-yaml ~100 KB),
// so an unminified build is ~1.28 MB. The budget is met by minifying that single-file output
// (measured ~695 KB): a within-file, semantics-preserving transform that leaves the one-file loader
// topology unchanged - unlike code-splitting, which emits sibling chunks and would require live Senpi
// loader validation this focused repair cannot perform. `bundle-purity.test.ts` still enforces the
// peer/leak boundary against the minified import shape, so minification cannot silently smuggle a
// non-peer dependency past the guard.
const BUDGET_BYTES = 700_000

describe("omo-senpi bundle size budget", () => {
  it("#given the built extension #when its byte size is measured #then it stays within the 700,000-byte plan budget", () => {
    expect(existsSync(builtExtensionPath), `missing built extension at ${builtExtensionPath}`).toBe(true)
    const bytes = statSync(builtExtensionPath).size
    // A trip here means the bundle grew past budget: split, lazy-load, or trim a dependency.
    // Never raise this ceiling to the failing value.
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES)
  })
})
