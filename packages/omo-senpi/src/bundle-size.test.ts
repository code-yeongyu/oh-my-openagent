import { describe, expect, it } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const builtExtensionPath = join(packageRoot, "plugin", "extensions", "omo.js")

// PLAN TARGET (todo 17e): omo.js non-minified <= 700_000 bytes. This target is currently UNMET and
// cannot be met inside this focused wave without regressing another acceptance criterion, so it is
// escalated to W2-V for an owner decision (code-split/lazy-load vs. a formal plan-budget amendment).
//
// Root cause (measured on the built bundle, NOT zod alone): the extension statically bundles every
// component's third-party dependency tree in one non-minified file -
//   zod v4            ~477 KB  (task/config validation via omo-config-core)
//   jsonc-parser      ~263 KB  (omo.json reader via omo-config-core)
//   vscode-jsonrpc    ~229 KB  (lsp component)
//   posthog-node      ~175 KB  (telemetry component, incl. @posthog/core)
//   js-yaml           ~100 KB
// Removing zod entirely still leaves ~804 KB, so the 700 KB target is not reachable by trimming any one
// dependency. The two plan-sanctioned fixes each fail this focused-repair boundary:
//   - code-split / lazy-load per component: emits sibling chunks and changes the loader/marketplace
//     bundle shape; it MUST be validated against a live Senpi runtime (per the omo-senpi QA law), which
//     this repair cannot do, so it belongs to the W2-V integration wave.
//   - minify: measured ~695 KB (under target) but bun's minified output emits `import{x}from"y"` with no
//     whitespace, which the bundle-purity static-import regex (`\bimport\s+`) does not match - it would
//     make bundle-purity pass VACUOUSLY, silently defeating the peer/leak guard. Rejected.
//
// Until W2-V adjudicates, this test does NOT raise the budget: it pins the true recorded baseline and
// guards against uncontrolled growth beyond it, so any regression surfaces immediately.
const TARGET_BYTES = 700_000
const RECORDED_BASELINE_BYTES = 1_281_596
const GROWTH_HEADROOM_BYTES = 40_000
const GROWTH_CEILING_BYTES = RECORDED_BASELINE_BYTES + GROWTH_HEADROOM_BYTES

describe("omo-senpi bundle size budget", () => {
  it("#given the built extension #when measured #then it stays within snug growth headroom of the recorded baseline", () => {
    expect(existsSync(builtExtensionPath), `missing built extension at ${builtExtensionPath}`).toBe(true)
    const bytes = statSync(builtExtensionPath).size
    // Snug guard anchored to the measured baseline (not the arbitrary 1.4 MB it replaced). Tripping this
    // means the bundle grew: split/lazy-load the new cost, do not widen the headroom silently.
    expect(bytes).toBeLessThanOrEqual(GROWTH_CEILING_BYTES)
  })

  it("#given the plan target #when compared to the recorded baseline #then the shortfall is explicit and unresolved (W2-V)", () => {
    // Documents that the 700 KB plan target is still unmet, so W2-V cannot lose track of the debt.
    expect(TARGET_BYTES).toBeLessThan(RECORDED_BASELINE_BYTES)
  })
})
