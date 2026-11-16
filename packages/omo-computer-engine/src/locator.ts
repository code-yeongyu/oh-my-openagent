import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { engineHost, type EngineLibc } from "./host.ts"
import { ENGINE_CHECKSUMS_ASSET, engineFileName, releaseAssetName } from "./release-assets.ts"

const QUARANTINE_ATTRIBUTE = "com.apple.quarantine"

/** Where a candidate came from; prebuild origins carry the checksums file trust reads. */
export type EngineOrigin = "runtime-dir" | "sidecar" | "package" | "dev-build"

export interface LocatorOptions {
  readonly platform?: string
  readonly arch?: string
  readonly libc?: EngineLibc
  /** The extracted payload root (OMO_PACKAGE_DIR); an empty string disables it. */
  readonly runtimeDir?: string
  /** Directory of the running executable; a compiled omo ships the engine as a sidecar beside it. */
  readonly execDir?: string
  /** Root of this package, holding `native/prebuilds/<host>/`. */
  readonly packageDir?: string
  /** Repository root whose `target/release/` holds a dev build. */
  readonly repoRoot?: string
  readonly isQuarantined?: (path: string) => boolean
}

export type EngineLocation =
  | {
      readonly kind: "located"
      readonly path: string
      readonly host: string
      readonly origin: EngineOrigin
      /** `null` for a dev build, which no release checksums file covers. */
      readonly checksumsPath: string | null
    }
  | {
      readonly kind: "unavailable"
      readonly host: string
      readonly code: "native-unavailable" | "quarantined"
      readonly attemptedPaths: readonly string[]
      readonly message: string
      readonly cause: string
      readonly reason?: "no-release-asset"
    }

interface Candidate {
  readonly path: string
  readonly origin: EngineOrigin
  readonly checksumsPath: string | null
}

const defaultPackageDir = join(dirname(fileURLToPath(import.meta.url)), "..")

function candidates(options: LocatorOptions, host: string): readonly Candidate[] {
  const file = engineFileName(options.platform ?? process.platform)
  const packageDir = options.packageDir ?? defaultPackageDir
  const runtimeDir = options.runtimeDir ?? process.env.OMO_PACKAGE_DIR ?? ""
  const prebuild = (root: string, origin: EngineOrigin): Candidate => ({
    path: join(root, "native", "prebuilds", host, file),
    origin,
    checksumsPath: join(root, "native", "prebuilds", ENGINE_CHECKSUMS_ASSET),
  })
  return [
    ...(runtimeDir === "" ? [] : [prebuild(runtimeDir, "runtime-dir")]),
    prebuild(options.execDir ?? dirname(process.execPath), "sidecar"),
    prebuild(packageDir, "package"),
    {
      path: join(options.repoRoot ?? join(packageDir, "..", ".."), "target", "release", file),
      origin: "dev-build",
      checksumsPath: null,
    },
  ]
}

/**
 * The first executable candidate: OMO_PACKAGE_DIR, the sidecar beside the executable, the package
 * prebuild, then a dev build. A quarantined file is never launched and its attribute is never
 * cleared on the user's behalf; only the launcher's own sidecar is accepted quarantined, because
 * every launch verifies its checksum and runs a copy written by us (stable-launch.ts).
 */
export function locateEngine(options: LocatorOptions = {}): EngineLocation {
  const platform = options.platform ?? process.platform
  const host = engineHost(platform, options.arch, options.libc)
  const isQuarantined = options.isQuarantined ?? ((path: string) => isQuarantinedFile(path, platform))
  const all = candidates(options, host)
  const causes: string[] = []
  let quarantined = false
  for (const candidate of all) {
    if (!existsSync(candidate.path)) {
      causes.push(`${candidate.path}: missing`)
      continue
    }
    if (candidate.origin !== "sidecar" && isQuarantined(candidate.path)) {
      quarantined = true
      causes.push(`${candidate.path}: blocked, ${QUARANTINE_ATTRIBUTE} is present`)
      continue
    }
    if (!isExecutable(candidate.path)) {
      causes.push(`${candidate.path}: not executable`)
      continue
    }
    return {
      kind: "located",
      path: candidate.path,
      host,
      origin: candidate.origin,
      checksumsPath: candidate.checksumsPath,
    }
  }
  const attemptedPaths = all.map((candidate) => candidate.path)
  const noAsset = causes.every((cause) => cause.endsWith(": missing")) && releaseAssetName(host) === null
  const message = quarantined
    ? `The omo-computer-engine binary for ${host} is quarantined by macOS Gatekeeper.`
    : noAsset
      ? `No omo-computer-engine is published for ${host}; computer use is unavailable on this host.`
      : `No omo-computer-engine binary is available for ${host}.`
  return {
    kind: "unavailable",
    host,
    code: quarantined ? "quarantined" : "native-unavailable",
    attemptedPaths,
    message,
    cause: causes.join("; "),
    ...(noAsset ? { reason: "no-release-asset" as const } : {}),
  }
}

/** `xattr -p` exits 0 only when the attribute is present; a failed probe never rejects. */
function isQuarantinedFile(path: string, platform: string = process.platform): boolean {
  if (platform !== "darwin") return false
  const probe = spawnSync("/usr/bin/xattr", ["-p", QUARANTINE_ATTRIBUTE, path], { stdio: "ignore", timeout: 2000 })
  return probe.error === undefined && probe.status === 0
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error) return false
    throw error
  }
}
