import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { exitOf, INSTALL_UPDATE_EXITS } from "./bin/lib/install-calls.js"
import { isPrintOnlyUpdate, updateUsageAnswer } from "./bin/lib/update-args.js"
import { isProvisionedExecutable } from "./compile-runtime"
import {
  BinaryUpdateError,
  installReleaseBinary,
  releaseVersionOf,
  type BinaryInstallRequest,
  type BinaryUpdateCode,
} from "./compiled-update-install"
export { releaseVersionOf } from "./compiled-update-install"

export const RELEASES_URL = "https://github.com/code-yeongyu/oh-my-openagent/releases"
const RELEASES_API = "https://api.github.com/repos/code-yeongyu/oh-my-openagent/releases?per_page=100"
import { RELEASE_VERSION } from "./release-version"
const RELEASE_TARGET = /^(?:darwin|linux|windows)-(?:x64|arm64)(?:-musl)?(?:-baseline)?$/

export type FetchReleases = () => Promise<unknown>
export type PackageOwner = { readonly manager: "pacman" | "dpkg" | "rpm" | "brew" | "nix"; readonly pkg: string }
export type ProbeOwner = (path: string, platform: NodeJS.Platform) => PackageOwner | undefined
/** Runs one ownership query; undefined when the tool is missing, fails, or prints nothing. */
export type RunOwnerQuery = (command: string, args: readonly string[]) => string | undefined
export type CompiledUpdateResult = {
  readonly output: string
  readonly exitCode: number
  readonly stream?: "stdout" | "stderr"
  readonly errorCode?: BinaryUpdateCode
}

export function releaseAssetName(releaseTarget: unknown, platform: NodeJS.Platform, arch: string): string {
  const flavor =
    typeof releaseTarget === "string" && RELEASE_TARGET.test(releaseTarget)
      ? releaseTarget
      : `${platform === "win32" ? "windows" : platform}-${arch}`
  return flavor.startsWith("windows-") ? `omo-${flavor}.exe` : `omo-${flavor}`
}

function readRelease(release: unknown): { readonly version: string; readonly assets: readonly string[] } | undefined {
  if (typeof release !== "object" || release === null || Reflect.get(release, "draft") === true) return undefined
  const tag = Reflect.get(release, "tag_name")
  const assets = Reflect.get(release, "assets")
  if (typeof tag !== "string" || !Array.isArray(assets)) throw new Error("GitHub release has no tag_name or assets")
  const version = tag.replace(/^v/, "")
  if (!RELEASE_VERSION.test(version)) return undefined
  return {
    version,
    assets: assets.map((asset) =>
      typeof asset === "object" && asset !== null ? String(Reflect.get(asset, "name")) : "",
    ),
  }
}

/**
 * The newest release on the running build's channel that ships `asset`, or undefined when the running
 * version is already the newest. A stable build only moves to stable releases; a beta build follows
 * the newest release of either kind. GitHub's Latest badge is not used: it goes to betas too.
 */
export function pickUpdateVersion(currentVersion: string, releases: unknown, asset: string): string | undefined {
  if (!Array.isArray(releases)) throw new Error("GitHub releases payload is not an array")
  const stableOnly = !currentVersion.includes("-")
  let newest: string | undefined
  for (const entry of releases) {
    const release = readRelease(entry)
    if (release === undefined || !release.assets.includes(asset)) continue
    if (stableOnly && release.version.includes("-")) continue
    if (newest === undefined || Bun.semver.order(release.version, newest) > 0) newest = release.version
  }
  if (newest === undefined) throw new Error(`no ${stableOnly ? "stable " : ""}release ships ${asset}`)
  return Bun.semver.order(newest, currentVersion) > 0 ? newest : undefined
}

// The documented installer. It replaces the launcher in its install dir (OMO_INSTALL_DIR, default ~/.local/bin).
export function installCommand(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "irm https://get.omo.dev/install.ps1 | iex"
    : "curl -fsSL https://get.omo.dev/install.sh | bash"
}

const posixQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const powershellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`

// Swap, never overwrite: writing over a running executable fails (ETXTBSY / Windows file lock).
export function replaceCommand(url: string, destination: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const [src, dest, old] = [url, destination, `${destination}.old`].map(powershellQuote)
    const next = powershellQuote(`${destination}.new`)
    return `curl.exe -fsSL ${src} -o ${next}; if ($?) { Move-Item -Force -LiteralPath ${dest} -Destination ${old}; Move-Item -LiteralPath ${next} -Destination ${dest} }`
  }
  const next = posixQuote(`${destination}.new`)
  return `curl -fsSL ${posixQuote(url)} -o ${next} && chmod +x ${next} && mv -f ${next} ${posixQuote(destination)}`
}

const runOwnerQuery: RunOwnerQuery = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 3_000, windowsHide: true })
  if (result.error !== undefined || result.status !== 0) return undefined
  return result.stdout.trim() || undefined
}

/**
 * The system package manager that owns `path`, or undefined. Fails open: a missing tool, a failed or slow
 * query, or an unowned path all fall back to the plain replace command (#9585).
 */
export function probePackageOwner(
  path: string,
  platform: NodeJS.Platform,
  run: RunOwnerQuery = runOwnerQuery,
): PackageOwner | undefined {
  let resolved = path
  try {
    resolved = realpathSync(path)
  } catch {
    /* keep the given path */
  }
  const nix = /^\/nix\/store\/[0-9a-z]{32}-([^/]+)\//.exec(resolved)
  if (nix !== null) return { manager: "nix", pkg: nix[1] }
  const cellar = /\/Cellar\/([^/]+)\//.exec(resolved)
  if (cellar !== null) return { manager: "brew", pkg: cellar[1] }
  if (platform !== "linux") return undefined
  const pacman = run("pacman", ["-Qqo", resolved])
  if (pacman !== undefined) return { manager: "pacman", pkg: pacman.split("\n")[0] }
  const dpkg = run("dpkg-query", ["-S", resolved])?.split(":")[0]
  if (dpkg) return { manager: "dpkg", pkg: dpkg.split(",")[0].trim() }
  const rpm = run("rpm", ["-qf", "--qf", "%{NAME}", resolved])
  if (rpm !== undefined) return { manager: "rpm", pkg: rpm.split("\n")[0] }
  return undefined
}

function ownedUpdateLine(owner: { readonly manager: PackageOwner["manager"]; readonly pkg: string }): string {
  const how = {
    pacman: `update it with pacman or your AUR helper, e.g. \`yay -Syu ${owner.pkg}\``,
    dpkg: `update it with apt, e.g. \`sudo apt install --only-upgrade ${owner.pkg}\``,
    rpm: `update it with dnf, e.g. \`sudo dnf upgrade ${owner.pkg}\``,
    brew: `update it with \`brew upgrade ${owner.pkg}\``,
    nix: "update it through nix",
  }[owner.manager]
  return `omo: installed via ${owner.manager} (${owner.pkg}); ${how}`
}

export const fetchGitHubReleases: FetchReleases = async () => {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "omo" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return response.json()
}

type CompiledUpdatePorts = {
  readonly omoAiVersion: string
  readonly releaseTarget: unknown
  readonly destination: string
  /** The provisioned runtime executable under ~/.omo/binary-runtime/<version>/. */
  readonly provisioned?: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly fetchReleases: FetchReleases
  readonly probeOwner?: ProbeOwner
  readonly install?: (request: BinaryInstallRequest) => Promise<void>
}

/** install.update's value in the compiled edition: the release it moved to, or would move to with dry_run. */
export type CompiledInstallUpdate = {
  readonly state: "printed" | "up_to_date" | "updated"
  readonly before: string
  readonly version: string
  readonly asset: string
  readonly destination: string
  readonly command: string
  readonly ran: boolean
}

type CompiledUpdateFailure = {
  readonly kind: "error"
  readonly error: {
    readonly code: "install_failed" | "service_unreachable" | "unsupported"
    readonly message: string
    readonly next_action: string
    readonly details:
      | { readonly reason: "package_manager_owned"; readonly manager: PackageOwner["manager"]; readonly pkg: string }
      | { readonly reason: "release_unresolved"; readonly asset: string; readonly cause: string }
      | {
          readonly reason: "provisioned_copy"
          readonly before: string
          readonly version: string
          readonly destination: string
          readonly installer: string
        }
      | { readonly reason: "binary_install"; readonly error_code: BinaryUpdateCode; readonly cause: string }
  }
}

const INSTALL_NEXT = "Read details.reason, fix what it names, then call install.update again."

/**
 * install.update({ dry_run? }) for the compiled binary: resolves the newest release on this build's channel that ships
 * this platform's asset and, unless dry_run, replaces the launched binary with it. Nothing is printed.
 */
async function compiledInstallUpdate(
  input: { readonly dry_run?: boolean },
  ports: CompiledUpdatePorts,
): Promise<{ readonly kind: "ok"; readonly value: CompiledInstallUpdate } | CompiledUpdateFailure> {
  // A binary a package manager owns must not get a curl-and-mv replace command: it either fails on a
  // root-owned path or leaves the manager tracking a file it no longer installed.
  const owner = ports.probeOwner?.(ports.destination, ports.platform)
  if (owner !== undefined) {
    return {
      kind: "error",
      error: {
        code: "unsupported",
        message: `this omo is installed by ${owner.manager}`,
        next_action: "Update omo with the package manager that installed it.",
        details: { reason: "package_manager_owned", manager: owner.manager, pkg: owner.pkg },
      },
    }
  }
  const asset = releaseAssetName(ports.releaseTarget, ports.platform, ports.arch)
  const before = releaseVersionOf(ports.omoAiVersion)
  let target: string | undefined
  try {
    target = pickUpdateVersion(before, await ports.fetchReleases(), asset)
  } catch (error) {
    return {
      kind: "error",
      error: {
        code: "service_unreachable",
        message: "could not resolve a release",
        next_action: "Check the network, then retry.",
        details: { reason: "release_unresolved", asset, cause: error instanceof Error ? error.message : String(error) },
      },
    }
  }
  const answer = (state: CompiledInstallUpdate["state"], version: string, command: string, ran: boolean) =>
    ({ kind: "ok", value: { state, before, version, asset, destination: ports.destination, command, ran } }) as const
  if (target === undefined) return answer("up_to_date", before, "", false)
  // The launcher rewrites its runtime copy on every launch, so a replace command aimed there is undone
  // by the next run. Reached only when the runtime copy was started directly, without a launcher.
  if (ports.provisioned !== undefined && isProvisionedExecutable(ports.destination, ports.provisioned)) {
    return {
      kind: "error",
      error: {
        code: "unsupported",
        message: `${ports.destination} is the provisioned runtime copy, not the installed omo`,
        next_action: "Update the installed omo with the installer named in details.installer.",
        details: {
          reason: "provisioned_copy",
          before,
          version: target,
          destination: ports.destination,
          installer: installCommand(ports.platform),
        },
      },
    }
  }
  const command = replaceCommand(`${RELEASES_URL}/download/v${target}/${asset}`, ports.destination, ports.platform)
  if (input.dry_run === true) return answer("printed", target, command, false)
  try {
    await (ports.install ?? installReleaseBinary)({
      destination: ports.destination,
      asset,
      version: target,
      platform: ports.platform,
    })
    return answer("updated", target, command, true)
  } catch (error) {
    return {
      kind: "error",
      error: {
        code: "install_failed",
        message: "the release binary was not installed",
        next_action: INSTALL_NEXT,
        details: {
          reason: "binary_install",
          error_code: error instanceof BinaryUpdateError ? error.code : "install_failed",
          cause: (error instanceof Error ? error.message : String(error))
            .replace(/[\r\n\x00-\x1f\x7f-\x9f]/g, " ")
            .slice(0, 500),
        },
      },
    }
  }
}

/** `omo update` in the compiled edition: the usage answers, then install.update's answer as the command prints it. */
export async function compiledUpdate(
  options: CompiledUpdatePorts & { readonly args?: readonly string[] },
): Promise<CompiledUpdateResult> {
  const usage = options.args === undefined ? undefined : updateUsageAnswer(options.args)
  if (usage !== undefined) return { output: usage.text, exitCode: usage.exitCode, stream: usage.stream }
  const answer = await compiledInstallUpdate({ dry_run: isPrintOnlyUpdate(options.args ?? []) }, options)
  if (answer.kind === "ok") {
    const { state, before, version, command } = answer.value
    if (state === "up_to_date")
      return { output: `omo ${before} is the newest ${before.includes("-") ? "beta" : "stable"} release`, exitCode: 0 }
    if (state === "printed")
      return {
        output: `omo ${version} is available (running ${before}). Replace this binary with:\n${command}`,
        exitCode: 0,
      }
    return { output: `omo updated ${before} -> ${version}`, exitCode: 0 }
  }
  const details = answer.error.details
  switch (details.reason) {
    case "package_manager_owned":
      return {
        output: ownedUpdateLine(details),
        exitCode: exitOf(INSTALL_UPDATE_EXITS, answer.error),
        stream: "stderr",
      }
    case "release_unresolved":
      return {
        output: `omo update could not resolve a release (${details.cause}). Download ${details.asset} from ${RELEASES_URL}`,
        exitCode: exitOf(INSTALL_UPDATE_EXITS, answer.error),
      }
    case "provisioned_copy":
      return {
        output: `omo ${details.version} is available (running ${details.before}), but ${details.destination} is the provisioned runtime copy, not the installed omo. Update the installed omo with:\n${details.installer}`,
        exitCode: exitOf(INSTALL_UPDATE_EXITS, answer.error),
        stream: "stderr",
      }
    case "binary_install":
      return {
        output: `omo update: ${details.error_code}: ${details.cause}`,
        exitCode: exitOf(INSTALL_UPDATE_EXITS, answer.error),
        stream: "stderr",
        errorCode: details.error_code,
      }
  }
}
