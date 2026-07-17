import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export interface SenpiDaemonRuntime {
  readonly cliPath: string
  readonly version: string
}

export function resolveSenpiPackagedDaemonRuntime(importerUrl: string = import.meta.url): SenpiDaemonRuntime {
  const cliPath = fileURLToPath(new URL("../runtime/lsp-daemon/dist/cli.js", importerUrl))
  const packageJsonPath = fileURLToPath(new URL("../runtime/lsp-daemon/dist/package.json", importerUrl))
  if (!existsSync(cliPath)) throw new Error(`Senpi packaged LSP daemon CLI is missing: ${cliPath}`)
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`Senpi packaged LSP daemon version is missing: ${packageJsonPath}`)
  }
  return { cliPath, version: parsed.version }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
