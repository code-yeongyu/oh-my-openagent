import type { SkippedTestRoot } from "./held-test-root.mjs"

export function diagnoseHeldTestRoot(root: string): Pick<SkippedTestRoot, "holders" | "diagnosticErrors">
