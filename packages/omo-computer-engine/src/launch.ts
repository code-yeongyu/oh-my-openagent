import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { join } from "node:path"

import { locateEngine, type LocatorOptions } from "./locator.ts"
import { EngineLaunchRefused } from "./refusal.ts"
import { engineFileName } from "./release-assets.ts"
import { RELEASE_DIGESTS } from "./release-digests.ts"
import { launchFromStablePath } from "./stable-launch.ts"
import {
  runSystemCodesign,
  sha256File,
  verifyChecksum,
  verifyDesignatedRequirement,
  type CodesignRunner,
  type PinnedDigests,
} from "./trust.ts"

export interface LaunchOptions {
  readonly cwd?: string
  readonly env: Readonly<Record<string, string>>
  /** macOS responsibility disclaim; only the launcher bundle can do it (row 40), so it refuses here. */
  readonly disclaimTcc?: boolean
}

export interface LaunchedEngine<C> {
  readonly child: C
  /** The stable path the engine runs from. */
  readonly path: string
  readonly host: string
  readonly sha256: string
}

/** The `launch` factory the hosts inject into the SDK's `spawn` transport. */
export type Launch<C = ChildProcessWithoutNullStreams> = (
  args: readonly string[],
  options: LaunchOptions,
) => Promise<LaunchedEngine<C>>

export type SpawnEngine<C> = (path: string, args: readonly string[], options: LaunchOptions) => C

export interface LaunchFactoryOptions<C> {
  readonly locator?: LocatorOptions
  /** Root of the per-host stable directories the engine runs from. */
  readonly stableDir: string
  /** A dev build (`target/release`) has no release checksum; it launches only when a dev host opts in. */
  readonly allowDevBuild?: boolean
  readonly runCodesign?: CodesignRunner
  readonly spawnEngine?: SpawnEngine<C>
  /** The digests a prebuild must match; the package's own pinned table unless a test or the QA driver stages one. */
  readonly pinnedDigests?: PinnedDigests
}

const spawnWithPipes: SpawnEngine<ChildProcessWithoutNullStreams> = (path, args, options) =>
  spawn(path, [...args], { cwd: options.cwd, env: { ...options.env }, stdio: "pipe" })

export function createLaunch(
  options: LaunchFactoryOptions<ChildProcessWithoutNullStreams> & { readonly spawnEngine?: undefined },
): Launch
export function createLaunch<C>(options: LaunchFactoryOptions<C> & { readonly spawnEngine: SpawnEngine<C> }): Launch<C>
/**
 * locate -> sha256 against the digest pinned in the package and the checksums file beside the
 * prebuild -> designated requirement (macOS)
 * on the staged copy -> spawn from the stable path under the lock. Every refusal is an
 * `EngineLaunchRefused` thrown before any process exists.
 */
export function createLaunch<C>(options: LaunchFactoryOptions<C>): Launch<C | ChildProcessWithoutNullStreams> {
  const platform = options.locator?.platform ?? process.platform
  const runCodesign = options.runCodesign ?? runSystemCodesign
  const spawnEngine = options.spawnEngine ?? spawnWithPipes
  return async (args, launchOptions) => {
    const located = locateEngine(options.locator)
    if (located.kind === "unavailable") {
      const reason =
        located.code === "quarantined"
          ? "quarantined"
          : located.reason === "no-release-asset"
            ? "no_release_asset"
            : "engine_unavailable"
      throw new EngineLaunchRefused(reason, located.host, `${located.message} (${located.cause})`)
    }
    if (launchOptions.disclaimTcc === true && platform === "darwin") {
      throw new EngineLaunchRefused(
        "disclaim_unavailable",
        located.host,
        "the responsibility disclaim needs the launcher bundle",
      )
    }
    if (located.checksumsPath === null && options.allowDevBuild !== true) {
      throw new EngineLaunchRefused("unverified_dev_build", located.host, `${located.path} has no release checksum`)
    }
    const verdict =
      located.checksumsPath === null
        ? { kind: "trusted" as const, sha256: sha256File(located.path) }
        : verifyChecksum(located.path, located.host, located.checksumsPath, options.pinnedDigests ?? RELEASE_DIGESTS)
    if (verdict.kind === "refused") throw new EngineLaunchRefused(verdict.reason, located.host, verdict.detail)
    const launched = launchFromStablePath(
      {
        path: located.path,
        host: located.host,
        sha256: verdict.sha256,
        directory: join(options.stableDir, located.host),
        fileName: engineFileName(platform),
      },
      (path) => spawnEngine(path, args, launchOptions),
      (staged) => verifyDesignatedRequirement(staged, { platform, runCodesign }) !== "mismatch",
    )
    return { child: launched.value, path: launched.path, host: located.host, sha256: verdict.sha256 }
  }
}
