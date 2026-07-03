import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { isAbsolute } from "node:path"

import { COMMENT_CHECKER_ENV_KEY, COMMENT_CHECKER_PACKAGE_NAME } from "./constants"
import type { SenpiCommentCheckerBinaryResolverOptions } from "./types"
import { isCommentCheckerPackage } from "./utils"

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

  const binaryName = (options.platform ?? process.platform) === "win32" ? "comment-checker.exe" : "comment-checker"
  const pathLookup = options.pathLookup ?? Bun.which
  return pathLookup(binaryName) ?? null
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
    if (error instanceof Error) {
      return null
    }
    throw error
  }
}
