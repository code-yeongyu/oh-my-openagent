import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { COVERAGE_RUNTIME } from "./category-coverage.js"
import { packageRoot } from "./package-paths.js"

// The launcher is plain JS, so it reaches the TypeScript config loader through the same staged
// runtime bundle the category-coverage and computer-use reports use (category-coverage-entry.ts).
async function loadRuntime() {
  return import(pathToFileURL(join(packageRoot, COVERAGE_RUNTIME)).href)
}

/**
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, loadRuntime?: () => Promise<any> }} [options]
 * @returns {Promise<string[]>}
 */
export async function doctorConfigLines(options = {}) {
  try {
    const runtime = await (options.loadRuntime ?? loadRuntime)()
    return [...runtime.configDoctorLines({ cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env })]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [`WARN config: diagnostics unavailable: ${message}`]
  }
}
