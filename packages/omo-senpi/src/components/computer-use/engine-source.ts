import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  desktopEngineReleaseAssetName,
  getDesktopEngineHost,
  locateDesktopEngine,
  type DesktopEngineLocatorOptions,
} from "@oh-my-opencode/senpi-desktop-engine"
import {
  acquiringEngineChildFactory,
  type ChildFactory,
  DesktopEngineUnavailableError,
  engineChildFactory,
} from "@oh-my-opencode/senpi-desktop-service"
import { explicitPathDiagnostic, resolveInstalledEngine } from "./installed-engine"

type Env = Readonly<Record<string, string | undefined>>

function manifestVersion(packageDir: string, names: readonly string[]): string | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
  } catch {
    return undefined
  }
  if (typeof manifest !== "object" || manifest === null) return undefined
  const name = Reflect.get(manifest, "name")
  const version = Reflect.get(manifest, "version")
  return typeof name === "string" && names.includes(name) && typeof version === "string" && version.length > 0
    ? version
    : undefined
}

/**
 * The omo release this session runs, which names the GitHub release that carries the engine binary:
 * the compiled runtime's stamped manifest (`OMO_PACKAGE_DIR`), else the `omo-ai` package the npm
 * launcher runs from (`OMO_BIN` is its `bin/omo.js`). Undefined outside an omo launch.
 */
export function omoReleaseVersion(env: Env): string | undefined {
  const packageDir = env.OMO_PACKAGE_DIR?.trim()
  if (packageDir) {
    const stamped = manifestVersion(packageDir, ["omo"])
    if (stamped !== undefined) return stamped
  }
  const bin = env.OMO_BIN?.trim()
  return bin ? manifestVersion(dirname(dirname(bin)), ["omo-ai"]) : undefined
}

/**
 * `computer.engine_path` wins; an omo launch acquires the engine for its own release (local install
 * first, then the verified GitHub release download); anything else uses the synchronous locator.
 */
export function defaultEngineChild(env: Env = process.env, locatorOptions?: DesktopEngineLocatorOptions): (enginePath: string | undefined) => ChildFactory {
  return (enginePath) => {
    if (enginePath !== undefined) return explicitEngineChild(enginePath)
    const version = omoReleaseVersion(env)
    if (version !== undefined) return acquiringEngineChildFactory({ version })
    if (locatorOptions === undefined) return engineChildFactory()
    return () => {
      const located = locateDesktopEngine(locatorOptions)
      if (located.path === null) throw new DesktopEngineUnavailableError(located.diagnostic)
      return engineChildFactory(located.path)()
    }
  }
}

/** Describes installation state only; neither acquisition nor an engine process is started. */
export function describeEngineSource(
  enginePath: string | undefined,
  env: Env,
  locatorOptions: DesktopEngineLocatorOptions = {},
): string {
  const version = omoReleaseVersion(env)
  const resolved = resolveInstalledEngine(enginePath, env, version, locatorOptions)
  if ("path" in resolved) {
    const release = resolved.source === "cache" ? `, omo v${version}` : ""
    return `found ${resolved.path} (${resolved.source}${release})`
  }
  if ("diagnostic" in resolved) {
    return resolved.diagnostic.reason === "no-release-asset"
      ? resolved.diagnostic.message
      : `${resolved.diagnostic.message} ${resolved.diagnostic.cause}`
  }
  const asset = desktopEngineReleaseAssetName(resolved.notInstalled.host)
  return version !== undefined && asset !== null
    ? `would download ${asset} from omo v${version} on first use`
    : `native-unavailable for ${resolved.notInstalled.host}: ${resolved.notInstalled.cause}`
}

function explicitEngineChild(enginePath: string): ChildFactory {
  const host = getDesktopEngineHost()
  const diagnostic = explicitPathDiagnostic(enginePath, host, process.platform)
  if (diagnostic !== undefined) {
    return () => {
      throw new DesktopEngineUnavailableError(diagnostic)
    }
  }
  return engineChildFactory(enginePath)
}
