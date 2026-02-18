import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type { DependencyInfo } from "../types"

async function checkBinaryExists(binary: string): Promise<{ exists: boolean; path: string | null }> {
  try {
    const path = Bun.which(binary)
    if (path) {
      return { exists: true, path }
    }
  } catch {
    // intentionally empty - binary not found
  }
  return { exists: false, path: null }
}

async function getBinaryVersion(binary: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode === 0) {
      return output.trim().split("\n")[0]
    }
  } catch {
    // intentionally empty - version unavailable
  }
  return null
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

  const version = await getBinaryVersion(binary.path!)

  return {
    name: "AST-Grep CLI",
    required: false,
    installed: true,
    version,
    path: binary.path,
  }
}

export async function checkAstGrepNapi(): Promise<DependencyInfo> {
  // Try dynamic import first (works in bunx temporary environments)
  try {
    await import("@ast-grep/napi")
    return {
      name: "AST-Grep NAPI",
      required: false,
      installed: true,
      version: null,
      path: null,
    }
  } catch {
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

function findCommentCheckerPackageBinary(): string | null {
  const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve("@code-yeongyu/comment-checker/package.json")
    const binaryPath = join(dirname(pkgPath), "bin", binaryName)
    if (existsSync(binaryPath)) return binaryPath
  } catch {
    // intentionally empty - package not installed
  }
  return null
}

export async function checkCommentChecker(): Promise<DependencyInfo> {
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

