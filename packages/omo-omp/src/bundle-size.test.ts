import { describe, expect, it } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const builtExtensionPath = join(packageRoot, "plugin", "extensions", "omo.js")

// The built omo.js must stay at or under 900,000 bytes (same budget as omo-senpi):
// the extension inlines every component's dependency tree into ONE non-split file.
// A trip here means the bundle grew past budget: split, lazy-load, or trim a dependency.
// Never raise this ceiling to the failing value.
const BUDGET_BYTES = 900_000

describe("omo-omp bundle size budget", () => {
  it("#given the built extension #when its byte size is measured #then it stays within the documented byte budget", () => {
    expect(existsSync(builtExtensionPath), `missing built extension at ${builtExtensionPath}`).toBe(true)
    const bytes = statSync(builtExtensionPath).size
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES)
  })
})
