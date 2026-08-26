import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Regression guard for issue #7339 (bundle half): omo.js and omo-task.js are separate bundles, so
// each carries its OWN copy of the lazy pi-tui boundary state. If nothing inside the omo-task.js
// graph calls loadPiTui(), the bundler dead-code-eliminates the loader and constant-folds piTui()
// into an unconditional throw - which is exactly how beta.20 shipped. The built artifact must
// therefore retain the dynamic pi-tui import: its presence proves some in-graph caller still warms
// the boundary (the task component's register()).
const TASK_BUNDLE = join(import.meta.dir, "..", "..", "..", "plugin", "extensions", "omo-task.js")

describe("omo-task.js bundle pi-tui loader retention", () => {
  it("#given the built task bundle #when scanned #then the lazy pi-tui loader dynamic import survives tree-shaking", () => {
    // given
    const source = readFileSync(TASK_BUNDLE, "utf8")

    // then
    expect(source).toContain('import("@earendil-works/pi-tui")')
  })
})
