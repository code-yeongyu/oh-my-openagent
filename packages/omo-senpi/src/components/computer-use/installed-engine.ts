import { accessSync, constants, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  desktopEngineReleaseAssetName,
  findCachedDesktopEngine,
  getDesktopEngineCandidatePaths,
  getDesktopEngineHost,
  isQuarantinedFile,
  locateDesktopEngine,
  type DesktopEngineLocateDiagnostic,
  type DesktopEngineLocatorOptions,
} from "@oh-my-opencode/senpi-desktop-engine"

export type InstalledEngine =
  | { readonly path: string; readonly source: string }
  | { readonly diagnostic: DesktopEngineLocateDiagnostic }
  | { readonly notInstalled: DesktopEngineLocateDiagnostic }

export function explicitPathDiagnostic(
  enginePath: string,
  host: string,
  platform: string,
  isQuarantined = (path: string) => isQuarantinedFile(path, platform),
): DesktopEngineLocateDiagnostic | undefined {
  const base = { host, attemptedPaths: [enginePath] }
  if (!existsSync(enginePath)) {
    return {
      ...base, code: "native-unavailable",
      message: `No senpi-desktop-engine binary is available for ${host}.`,
      cause: `${enginePath}: missing`,
    }
  }
  if (isQuarantined(enginePath)) {
    return {
      ...base, code: "quarantined",
      message: `The senpi-desktop-engine binary for ${host} is quarantined by macOS Gatekeeper: ${enginePath}.`,
      cause: `${enginePath}: blocked because com.apple.quarantine is present (macOS Gatekeeper)`,
    }
  }
  // Windows has no exec bit (X_OK only proves existence there); the engine must be a .exe.
  if (platform === "win32") {
    return /\.exe$/i.test(enginePath) ? undefined : notExecutable(base, host, `${enginePath}: not executable (expected a .exe file)`)
  }
  try {
    accessSync(enginePath, constants.X_OK)
    return undefined
  } catch (error) {
    if (!(error instanceof Error && "code" in error)) throw error
    return notExecutable(base, host, `${enginePath}: not executable (chmod +x)`)
  }
}

function notExecutable(
  base: { readonly host: string; readonly attemptedPaths: readonly string[] },
  host: string,
  cause: string,
): DesktopEngineLocateDiagnostic {
  return { ...base, code: "native-unavailable", message: `No senpi-desktop-engine binary is available for ${host}.`, cause }
}

/** One installed-source decision for status and doctor; never acquires, copies or starts an engine. */
export function resolveInstalledEngine(
  enginePath: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  version: string | undefined,
  locatorOptions: DesktopEngineLocatorOptions = {},
): InstalledEngine {
  const platform = locatorOptions.platform ?? process.platform
  const host = getDesktopEngineHost(platform, locatorOptions.arch, locatorOptions.libc)
  if (enginePath !== undefined) {
    const diagnostic = explicitPathDiagnostic(enginePath, host, platform, locatorOptions.isQuarantined)
    return diagnostic === undefined ? { path: enginePath, source: "explicit" } : { diagnostic }
  }
  const options = { ...locatorOptions, runtimeDir: locatorOptions.runtimeDir ?? env.OMO_PACKAGE_DIR ?? "" }
  const located = locateDesktopEngine(options)
  if (located.path !== null) {
    const candidates = getDesktopEngineCandidatePaths(options)
    const sources = options.runtimeDir
      ? ["runtime-dir", "sidecar", "package-prebuild", "dev-build"]
      : ["sidecar", "package-prebuild", "dev-build"]
    return { path: located.path, source: sources[candidates.indexOf(located.path)] }
  }
  if (located.diagnostic.code === "quarantined") return { diagnostic: located.diagnostic }
  if (version !== undefined) {
    const cached = findCachedDesktopEngine({
      host, version, cacheDir: join(env.HOME ?? homedir(), ".omo", "cache", "senpi-desktop-engine"),
    })
    if (cached.path !== null) return { path: cached.path, source: "cache" }
  }
  return desktopEngineReleaseAssetName(host) === null
    ? { diagnostic: located.diagnostic }
    : { notInstalled: located.diagnostic }
}
