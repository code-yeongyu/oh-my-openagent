import { homedir } from "node:os"
import { join } from "node:path"

import { AST_GREP_BIN_DIR_ENV_KEY } from "./install-script"
import { runtimeSlug, sgBinaryName } from "./sg-manifest"
import { SG_PATH_ENV_KEY, type SgCandidate, type SgResolverOptions, type SgResolutionTier } from "./types"

const HOMEBREW_PREFIXES = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin"],
  linux: ["/home/linuxbrew/.linuxbrew/bin", "/usr/local/bin"],
  win32: [],
} as const satisfies Record<"darwin" | "linux" | "win32", readonly string[]>

function nonEmptyValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed
}

function astGrepBinaryName(platform: NodeJS.Platform): "ast-grep" | "ast-grep.exe" {
  return platform === "win32" ? "ast-grep.exe" : "ast-grep"
}

function candidate(tier: SgResolutionTier, path: string): SgCandidate {
  return { path, tier }
}

function envOverrideCandidates(env: Record<string, string | undefined>): readonly SgCandidate[] {
  const override = nonEmptyValue(env[SG_PATH_ENV_KEY])
  return override === null ? [] : [candidate("env-override", override)]
}

function omoRuntimeCandidates(options: {
  readonly arch: string
  readonly env: Record<string, string | undefined>
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly runtimeDir: string | undefined
}): readonly SgCandidate[] {
  const binaryName = sgBinaryName(options.platform)
  const slug = runtimeSlug(options.platform, options.arch)
  const paths: string[] = []
  if (options.runtimeDir !== undefined) paths.push(join(options.runtimeDir, binaryName))
  const codexHome = nonEmptyValue(options.env["CODEX_HOME"])
  if (codexHome !== null) paths.push(join(codexHome, "runtime", "ast-grep", slug, binaryName))
  paths.push(join(options.homeDir, ".omo", "runtime", "ast-grep", slug, binaryName))
  return paths.map((path) => candidate("omo-runtime", path))
}

function skillBinCandidates(options: {
  readonly env: Record<string, string | undefined>
  readonly packageDir: string | undefined
  readonly platform: NodeJS.Platform
}): readonly SgCandidate[] {
  const names = [astGrepBinaryName(options.platform), sgBinaryName(options.platform)]
  const directories: string[] = []
  const cacheDir = nonEmptyValue(options.env[AST_GREP_BIN_DIR_ENV_KEY])
  if (cacheDir !== null) directories.push(cacheDir)
  // `packageDir` covers a binary shipped next to its consumer, e.g. `<pkg>/bin/ast-grep`. No
  // caller supplies it yet; the ast-grep-mcp server component (plan todo 11) passes its own
  // package root here so a bundled binary outranks PATH.
  if (options.packageDir !== undefined) directories.push(join(options.packageDir, "bin"))
  return directories.flatMap((directory) => names.map((name) => candidate("skill-bin", join(directory, name))))
}

function homebrewCandidates(platform: NodeJS.Platform): readonly SgCandidate[] {
  const prefixes = platform === "darwin" || platform === "linux" || platform === "win32" ? HOMEBREW_PREFIXES[platform] : []
  const names = [astGrepBinaryName(platform), sgBinaryName(platform)]
  return prefixes.flatMap((prefix) => names.map((name) => candidate("homebrew", join(prefix, name))))
}

export interface SgCandidatePlan {
  readonly beforePath: readonly SgCandidate[]
  readonly afterPath: readonly SgCandidate[]
  readonly pathCommands: readonly string[]
}

export function planSgCandidates(options: SgResolverOptions): SgCandidatePlan {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const homeDir = options.homeDir ?? homedir()
  return {
    afterPath: homebrewCandidates(platform),
    beforePath: [
      ...envOverrideCandidates(env),
      ...omoRuntimeCandidates({ arch, env, homeDir, platform, runtimeDir: options.runtimeDir }),
      ...skillBinCandidates({ env, packageDir: options.packageDir, platform }),
    ],
    pathCommands: ["ast-grep", "sg"],
  }
}
