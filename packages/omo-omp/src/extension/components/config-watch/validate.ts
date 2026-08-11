import { createHash } from "node:crypto"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"

import {
  resolveUserOmoConfigDirectory,
  type OmoConfigEnv,
} from "@oh-my-opencode/omo-config-core"

import { loadSenpiOmoConfig, type SenpiConfigDiagnostic } from "../config-resolution"

const MERGED_OMO_CONFIG_DIAGNOSTIC_PATH = "(merged omo config)"
/** Matches the frozen config-watch validation wire shape without importing senpi internals. */
export type ConfigWatchValidation = { ok: true } | { ok: false; errors: string[] }

export interface OmoConfigValidator {
  validate(changedPaths: readonly string[]): ConfigWatchValidation
}

export interface CreateOmoConfigValidatorOptions {
  readonly cwd: string
  readonly env?: OmoConfigEnv
  readonly platform?: NodeJS.Platform
  readonly loadConfig?: typeof loadSenpiOmoConfig
}

type FingerprintedDiagnostic = {
  readonly diagnostic: SenpiConfigDiagnostic
  readonly fingerprint: string
}

function fingerprintDiagnostic(diagnostic: SenpiConfigDiagnostic): string {
  return createHash("sha256")
    .update(`${diagnostic.kind}\u0000${diagnostic.path}\u0000${diagnostic.message}`)
    .digest("hex")
}

function isEqualToOrDescendantOf(path: string, parent: string): boolean {
  const pathToChild = relative(resolve(parent), resolve(path))
  return pathToChild === "" || (!pathToChild.startsWith("..") && !isAbsolute(pathToChild))
}

function containingConfigDirectory(path: string, userConfigDirectory: string): string | null {
  const resolvedPath = resolve(path)
  const resolvedUserConfigDirectory = resolve(userConfigDirectory)
  if (isEqualToOrDescendantOf(resolvedPath, resolvedUserConfigDirectory)) return resolvedUserConfigDirectory

  let currentPath = resolvedPath
  while (true) {
    if (basename(currentPath) === ".omo") return currentPath
    const parentPath = dirname(currentPath)
    if (parentPath === currentPath) return null
    currentPath = parentPath
  }
}

function isAttributableDiagnostic(
  diagnostic: SenpiConfigDiagnostic,
  changedPaths: readonly string[],
  userConfigDirectory: string,
): boolean {
  if (diagnostic.path === MERGED_OMO_CONFIG_DIAGNOSTIC_PATH || diagnostic.kind === "model_catalog_cycle") return true

  const diagnosticConfigDirectory = containingConfigDirectory(diagnostic.path, userConfigDirectory)
  return changedPaths.some((changedPath) => {
    if (isEqualToOrDescendantOf(diagnostic.path, changedPath)) return true
    if (diagnosticConfigDirectory === null) return false
    return containingConfigDirectory(changedPath, userConfigDirectory) === diagnosticConfigDirectory
  })
}

function formatDiagnostic(diagnostic: SenpiConfigDiagnostic): string {
  return diagnostic.message
}

/**
 * Takes a diagnostics baseline immediately, then advances it only after a
 * valid change. Rejected diagnostics remain unresolved until the loader no
 * longer emits them, which prevents unrelated changes from bypassing a bad
 * edit that is still on disk.
 */
export function createOmoConfigValidator(options: CreateOmoConfigValidatorOptions): OmoConfigValidator {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  const userConfigDirectory = resolveUserOmoConfigDirectory(env)
  let baseline = new Set(loadConfig({ cwd: options.cwd, env, platform }).diagnostics.map(fingerprintDiagnostic))
  const unresolvedRejected = new Set<string>()

  return {
    validate(changedPaths: readonly string[]): ConfigWatchValidation {
      const diagnostics = loadConfig({ cwd: options.cwd, env, platform }).diagnostics
      const fingerprintedDiagnostics = diagnostics.map(
        (diagnostic): FingerprintedDiagnostic => ({ diagnostic, fingerprint: fingerprintDiagnostic(diagnostic) }),
      )
      const diagnosticsByFingerprint = new Map(
        fingerprintedDiagnostics.map((entry) => [entry.fingerprint, entry.diagnostic]),
      )

      for (const fingerprint of unresolvedRejected) {
        if (!diagnosticsByFingerprint.has(fingerprint)) unresolvedRejected.delete(fingerprint)
      }

      for (const entry of fingerprintedDiagnostics) {
        if (baseline.has(entry.fingerprint)) continue
        if (!isAttributableDiagnostic(entry.diagnostic, changedPaths, userConfigDirectory)) continue
        unresolvedRejected.add(entry.fingerprint)
      }

      if (unresolvedRejected.size > 0) {
        const errors = [...unresolvedRejected]
          .map((fingerprint) => diagnosticsByFingerprint.get(fingerprint))
          .filter((diagnostic): diagnostic is SenpiConfigDiagnostic => diagnostic !== undefined)
          .map(formatDiagnostic)
        return { ok: false, errors }
      }

      baseline = new Set(fingerprintedDiagnostics.map((entry) => entry.fingerprint))
      return { ok: true }
    },
  }
}

export { MERGED_OMO_CONFIG_DIAGNOSTIC_PATH }
