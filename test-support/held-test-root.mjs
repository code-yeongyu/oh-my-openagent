import { rmSync } from "node:fs"
import { diagnoseHeldTestRoot } from "./windows-held-root.mjs"

// Exact skipped paths are retained for the suite's leak report, never a prefix-wide exemption.
// The preload and tests must resolve this same module instance; otherwise the leak check fails loudly.
export const skippedTestRoots = new Map()

export function removeTestRootBestEffort(root, {
  remove = (path) => rmSync(path, { recursive: true, force: true }),
  diagnose = diagnoseHeldTestRoot,
  report = console.warn,
} = {}) {
  try {
    remove(root)
    skippedTestRoots.delete(root)
    return true
  } catch (error) {
    // Shared with the abandoned-root sweep (#11190): a held root is deferred, not retried.
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (typeof code !== "string" || !["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(code)) throw error
    let diagnostic
    try {
      diagnostic = diagnose(root)
    } catch (failure) {
      diagnostic = { holders: [], diagnosticErrors: [String(failure)] }
    }
    const record = { root, code, ...diagnostic }
    skippedTestRoots.set(root, record)
    report("SKIPPED_TEST_TEMP_ROOT", JSON.stringify(record))
    return false
  }
}
