import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type { FindCommentCheckerPackageBinaryInput } from "./types"

export const COMMENT_CHECKER_PACKAGE_NAME = "@code-yeongyu/comment-checker"

// Older embedded Bun runtimes throw ResolveMessage objects, not Error instances.
export function isModuleResolutionMiss(error: unknown): boolean {
  return error instanceof Error || (
    typeof error === "object" && error !== null && "name" in error && error.name === "ResolveMessage"
  )
}

export function findCommentCheckerPackageBinary(input: FindCommentCheckerPackageBinaryInput): string | null {
  const packageName = input.packageName ?? COMMENT_CHECKER_PACKAGE_NAME
  const platformKey = `${input.platform ?? process.platform}-${input.arch ?? process.arch}`
  const packageDir = dirname(input.packageJsonPath)
  const candidates = [
    resolvePlatformPackageBinary(input.packageJsonPath, `${packageName}-${platformKey}`, input.binaryName),
    join(packageDir, "vendor", platformKey, input.binaryName),
    join(packageDir, "bin", input.binaryName),
  ]
  return candidates.find((candidate): candidate is string => candidate !== null && input.existsSync(candidate)) ?? null
}

function resolvePlatformPackageBinary(packageJsonPath: string, platformPackageName: string, binaryName: string): string | null {
  try {
    const manifestPath = createRequire(packageJsonPath).resolve(`${platformPackageName}/package.json`)
    return join(dirname(manifestPath), "bin", binaryName)
  } catch (error) {
    if (isModuleResolutionMiss(error)) return null
    throw error
  }
}
