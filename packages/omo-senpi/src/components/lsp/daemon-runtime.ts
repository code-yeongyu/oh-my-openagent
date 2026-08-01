import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"

export interface SenpiDaemonRuntime {
  readonly cliPath: string
  readonly version: string
}

export function resolveSenpiDaemonRuntime(
  env: Record<string, string | undefined> = process.env,
  packagedRuntime: SenpiDaemonRuntime = resolveSenpiPackagedDaemonRuntime(),
): SenpiDaemonRuntime {
  const cliOverride = env["OMO_LSP_DAEMON_CLI"]
  const versionOverride = env["OMO_LSP_DAEMON_VERSION"]
  const hasCliOverride = cliOverride !== undefined
  const hasVersionOverride = versionOverride !== undefined
  if (hasCliOverride !== hasVersionOverride) {
    throw new Error("OMO_LSP_DAEMON_CLI and OMO_LSP_DAEMON_VERSION must be set together")
  }
  if (!hasCliOverride || !hasVersionOverride) {
    if (!isAbsolute(packagedRuntime.cliPath)) {
      throw new Error("Packaged Senpi LSP daemon CLI path must be absolute")
    }
    return { cliPath: packagedRuntime.cliPath, version: validateDaemonVersion(packagedRuntime.version) }
  }
  if (!isAbsolute(cliOverride)) {
    throw new Error("OMO_LSP_DAEMON_CLI must be an absolute path to an existing regular file")
  }
  const stat = statSync(cliOverride, { throwIfNoEntry: false })
  if (!stat) throw new Error("OMO_LSP_DAEMON_CLI points to a missing file")
  if (!stat.isFile()) throw new Error("OMO_LSP_DAEMON_CLI must point to a regular file")
  return { cliPath: cliOverride, version: validateDaemonVersion(versionOverride) }
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

const DAEMON_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

function validateDaemonVersion(version: string): string {
  if (!DAEMON_VERSION_PATTERN.test(version)) {
    throw new Error("LSP daemon version must match [A-Za-z0-9][A-Za-z0-9._+-]{0,127}")
  }
  return version
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
