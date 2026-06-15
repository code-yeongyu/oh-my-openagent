import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type { DependencyInfo } from "../framework/types"
import { spawnWithTimeout } from "../framework/spawn-with-timeout"
import { getCachedBinaryPath } from "../../../hooks/comment-checker/downloader"
import { bunWhich } from "../../../shared/bun-which-shim"
import { isModuleResolutionFailure } from "../../../shared/module-resolution-failure"

type BinaryCheck =
  | { exists: true; path: string }
  | { exists: false; path: null }

async function checkBinaryExists(binary: string): Promise<BinaryCheck> {
  try {
    const path = bunWhich(binary)
    if (path) {
      return { exists: true, path }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  return { exists: false, path: null }
}

async function getBinaryVersion(binary: string): Promise<string | null> {
  try {
    const result = await spawnWithTimeout([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
    if (result.timedOut || result.exitCode !== 0) return null
    return result.stdout.trim().split("\n")[0] ?? null
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

export async function checkAstGrepCli(): Promise<DependencyInfo> {
  const binaryCheck = await checkBinaryExists("sg")
  const altBinaryCheck = !binaryCheck.exists ? await checkBinaryExists("ast-grep") : null

  const binary = binaryCheck.exists ? binaryCheck : altBinaryCheck
  if (!binary || !binary.exists) {
    return {
      name: "AST-Grep CLI",
      required: false,
      installed: false,
      version: null,
      path: null,
      installHint: "Install: npm install -g @ast-grep/cli",
    }
  }

  const version = await getBinaryVersion(binary.path)

  return {
    name: "AST-Grep CLI",
    required: false,
    installed: true,
    version,
    path: binary.path,
  }
}

export async function checkAstGrepNapi(
  importNapiProbe: () => Promise<unknown> = () => import("@ast-grep/napi"),
): Promise<DependencyInfo> {
  // Try dynamic import first (works in bunx temporary environments)
  try {
    await importNapiProbe()
    return {
      name: "AST-Grep NAPI",
      required: false,
      installed: true,
      version: null,
      path: null,
    }
  } catch (error) {
    if (!(error instanceof Error) && !isModuleResolutionFailure(error)) throw error
    // Fallback: check common installation paths
    const { existsSync } = await import("fs")
    const { join } = await import("path")
    const { homedir } = await import("os")

    const pathsToCheck = [
      join(homedir(), ".config", "opencode", "node_modules", "@ast-grep", "napi"),
      join(process.cwd(), "node_modules", "@ast-grep", "napi"),
    ]

    for (const napiPath of pathsToCheck) {
      if (existsSync(napiPath)) {
        return {
          name: "AST-Grep NAPI",
          required: false,
          installed: true,
          version: null,
          path: napiPath,
        }
      }
    }

    return {
      name: "AST-Grep NAPI",
      required: false,
      installed: false,
      version: null,
      path: null,
      installHint: "Will use CLI fallback if available",
    }
  }
}

function resolveCommentCheckerPackageJson(): string {
  const require = createRequire(import.meta.url)
  return require.resolve("@code-yeongyu/comment-checker/package.json")
}

export function findCommentCheckerPackageBinary(
  baseDirOverride?: string,
  resolvePackageJsonPath: () => string = resolveCommentCheckerPackageJson,
): string | null {
  const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
  const platformKey = `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`
  try {
    const packageDir = baseDirOverride ?? dirname(resolvePackageJsonPath())
    const vendorPath = join(packageDir, "vendor", platformKey, binaryName)
    if (existsSync(vendorPath)) return vendorPath
    const binPath = join(packageDir, "bin", binaryName)
    if (existsSync(binPath)) return binPath
  } catch (error) {
    if (!(error instanceof Error) && !isModuleResolutionFailure(error)) throw error
  }
  return null
}

export async function checkCommentChecker(): Promise<DependencyInfo> {
  // Check cached binary first (matches runtime resolution order)
  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    const version = await getBinaryVersion(cachedPath)
    return {
      name: "Comment Checker",
      required: false,
      installed: true,
      version,
      path: cachedPath,
    }
  }

  const binaryCheck = await checkBinaryExists("comment-checker")
  const resolvedPath = binaryCheck.exists ? binaryCheck.path : findCommentCheckerPackageBinary()

  if (!resolvedPath) {
    return {
      name: "Comment Checker",
      required: false,
      installed: false,
      version: null,
      path: null,
      installHint: "Hook will be disabled if not available",
    }
  }

  const version = await getBinaryVersion(resolvedPath)

  return {
    name: "Comment Checker",
    required: false,
    installed: true,
    version,
    path: resolvedPath,
  }
}
