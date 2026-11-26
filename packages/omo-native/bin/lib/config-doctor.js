import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { COVERAGE_RUNTIME } from "./category-coverage.js"
import { finding } from "./diagnostics-findings.js"
import { packageRoot } from "./package-paths.js"

// The launcher is plain JS, so it reaches the TypeScript config loader through the same staged
// runtime bundle the category-coverage and computer-use reports use (category-coverage-entry.ts).
async function loadRuntime() {
  return import(pathToFileURL(join(packageRoot, COVERAGE_RUNTIME)).href)
}

/**
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, loadRuntime?: () => Promise<any> }} [options]
 * @returns {Promise<import("./diagnostics-contract").DiagnosticFinding[]>}
 */
export async function doctorConfigFindings(options = {}) {
  try {
    const runtime = await (options.loadRuntime ?? loadRuntime)()
    return [...runtime.configDoctorFindings({ cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env })]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      finding("config.diagnostics", "warn", `config: diagnostics unavailable: ${message}`, {
        state: "diagnostics_unavailable",
        reason: message,
      }),
    ]
  }
}
