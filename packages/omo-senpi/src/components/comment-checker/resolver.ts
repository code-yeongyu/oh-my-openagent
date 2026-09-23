import { accessSync, constants, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join } from "node:path"

import { commentCheckerBinaryName, commentCheckerCacheDir } from "@oh-my-opencode/comment-checker-core"

import { COMMENT_CHECKER_CACHE_DIR_NAME, COMMENT_CHECKER_ENV_KEY, COMMENT_CHECKER_PACKAGE_NAME } from "./constants"
import type { SenpiCommentCheckerBinaryResolverOptions } from "./types"
import { isCommentCheckerPackage, isMissingModuleValue } from "./utils"

export function resolveSenpiCommentCheckerBinary(options: SenpiCommentCheckerBinaryResolverOptions = {}): string | null {
  const checkExists = options.existsSync ?? existsSync
  const env = options.env ?? process.env
  const envBinaryPath = env[COMMENT_CHECKER_ENV_KEY]?.trim()
  if (envBinaryPath !== undefined && envBinaryPath.length > 0 && isAbsolute(envBinaryPath) && checkExists(envBinaryPath)) {
    return envBinaryPath
  }

  const fromPackageApi = resolvePackageApiBinary({
    existsSync: checkExists,
    importMetaUrl: options.importMetaUrl ?? import.meta.url,
    requireModule: options.requireModule,
  })
  if (fromPackageApi !== null) {
    return fromPackageApi
  }

  const platform = options.platform ?? process.platform
  const binaryName = commentCheckerBinaryName(platform)
  const pathLookup = options.pathLookup ?? findExecutableOnPath
  const fromPath = pathLookup(binaryName)
  if (fromPath) return fromPath

  const cached = join(options.cacheDir ?? defaultCommentCheckerCacheDir(platform, env), binaryName)
  return checkExists(cached) ? cached : null
}

export function defaultCommentCheckerCacheDir(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string {
  return commentCheckerCacheDir({ platform, env, homedir: homedir(), cacheDirName: COMMENT_CHECKER_CACHE_DIR_NAME })
}

function findExecutableOnPath(binaryName: string): string | null {
  const pathValue = process.env.PATH
  if (!pathValue) return null
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, binaryName)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function isExecutableFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

interface PackageApiBinaryResolverInput {
  readonly existsSync: (path: string) => boolean
  readonly importMetaUrl: string
  readonly requireModule?: (moduleName: string) => unknown
}

function resolvePackageApiBinary(input: PackageApiBinaryResolverInput): string | null {
  try {
    const requireModule = input.requireModule ?? createRequire(input.importMetaUrl)
    const packageExports = requireModule(COMMENT_CHECKER_PACKAGE_NAME)
    if (!isCommentCheckerPackage(packageExports)) {
      return null
    }
    const binaryPath = packageExports.getBinaryPath()
    return input.existsSync(binaryPath) ? binaryPath : null
  } catch (error) {
    if (isMissingModuleValue(error)) {
      return null
    }
    throw error
  }
}
