import { execFileSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"

import { bunWhich } from "../runtime/which"
import { planSgCandidates } from "./sg-candidates"
import { sgBinaryNotFoundMessage, sgInstallHints } from "./sg-install-hints"
import { SG_BINARY_NOT_FOUND, type SgCandidate, type SgResolution, type SgResolverOptions } from "./types"

export const SG_VERSION_PROBE_TIMEOUT_MS = 5_000

interface CacheEntry {
  readonly fingerprint: string
  readonly resolution: SgResolution
}

let cacheEntry: CacheEntry | null = null

interface ResolverDeps {
  readonly fileExists: (filePath: string) => boolean
  readonly platform: NodeJS.Platform
  readonly runVersionProbeSync: (binaryPath: string) => string
  readonly which: (commandName: string) => string | null
}

export function clearSgResolutionCache(): void {
  cacheEntry = null
}

/**
 * Cache key: only a resolution over the same inputs may be reused, so callers that inject
 * different environments, platforms, or probes never observe each other's results.
 */
function cacheFingerprint(options: SgResolverOptions, plan: { readonly beforePath: readonly SgCandidate[] }): string {
  return JSON.stringify([
    options.platform ?? process.platform,
    options.arch ?? process.arch,
    plan.beforePath.map((candidate) => candidate.path),
  ])
}

function defaultFileExists(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  try {
    const stats = statSync(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

function defaultVersionProbe(binaryPath: string): string {
  return String(
    execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: SG_VERSION_PROBE_TIMEOUT_MS,
    }),
  )
}

/**
 * The single acceptance rule for every candidate in every tier: the probe must actually run and
 * report `ast-grep`. A non-zero exit, a thrown error, a 5s timeout, ENOENT, or EACCES all reject
 * the candidate, and resolution continues with the next one. Neither a candidate's name nor the
 * location it came from grants any exemption - a binary that cannot answer `--version` cannot be
 * used to run ast-grep either.
 */
function probePasses(binaryPath: string, deps: ResolverDeps): boolean {
  try {
    return deps.runVersionProbeSync(binaryPath).toLowerCase().includes("ast-grep")
  } catch {
    return false
  }
}

function acceptsCandidate(binaryPath: string, deps: ResolverDeps): boolean {
  return deps.fileExists(binaryPath) && probePasses(binaryPath, deps)
}

function firstAccepted(candidates: readonly SgCandidate[], deps: ResolverDeps): SgResolution | null {
  for (const candidate of candidates) {
    if (acceptsCandidate(candidate.path, deps)) return { found: true, path: candidate.path, tier: candidate.tier }
  }
  return null
}

function pathCandidates(commands: readonly string[], deps: ResolverDeps): readonly SgCandidate[] {
  const resolved: SgCandidate[] = []
  for (const commandName of commands) {
    const found = deps.which(commandName)
    if (found !== null) resolved.push({ path: found, tier: "path" })
  }
  return resolved
}

function notFound(platform: NodeJS.Platform): SgResolution {
  return {
    error: { code: SG_BINARY_NOT_FOUND, hints: sgInstallHints(platform), message: sgBinaryNotFoundMessage(platform) },
    found: false,
  }
}

function cacheIsStillValid(resolution: SgResolution, deps: ResolverDeps, revalidate: boolean): boolean {
  if (!resolution.found) return false
  if (!deps.fileExists(resolution.path)) return false
  return !revalidate || probePasses(resolution.path, deps)
}

function resolverDeps(options: SgResolverOptions): ResolverDeps {
  return {
    fileExists: options.fileExists ?? defaultFileExists,
    platform: options.platform ?? process.platform,
    runVersionProbeSync: options.runVersionProbeSync ?? defaultVersionProbe,
    which: options.which ?? bunWhich,
  }
}

/**
 * Resolve the ast-grep (`sg`) binary across five tiers, in order:
 * env override → OMO runtime dirs → skill bin cache → PATH → Homebrew/Linuxbrew prefixes.
 * Every candidate must be a non-empty regular file AND pass a 5s `--version` probe whose output
 * contains `ast-grep`; a candidate that fails for any reason is rejected and resolution continues
 * to the next candidate and tier.
 */
export function resolveSgBinarySync(options: SgResolverOptions = {}): SgResolution {
  const deps = resolverDeps(options)
  const useCache = options.cache ?? true
  try {
    const plan = planSgCandidates(options)
    const fingerprint = cacheFingerprint(options, plan)
    if (useCache && cacheEntry !== null && cacheEntry.fingerprint === fingerprint) {
      if (cacheIsStillValid(cacheEntry.resolution, deps, options.revalidate ?? false)) return cacheEntry.resolution
      cacheEntry = null
    }

    const resolution =
      firstAccepted(plan.beforePath, deps) ??
      firstAccepted(pathCandidates(plan.pathCommands, deps), deps) ??
      firstAccepted(plan.afterPath, deps) ??
      notFound(deps.platform)

    if (useCache && resolution.found) cacheEntry = { fingerprint, resolution }
    return resolution
  } catch {
    return notFound(deps.platform)
  }
}

export function findSgBinarySync(options: SgResolverOptions = {}): string | null {
  const resolution = resolveSgBinarySync(options)
  return resolution.found ? resolution.path : null
}
