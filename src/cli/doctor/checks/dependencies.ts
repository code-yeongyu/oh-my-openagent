import type { CheckResult, CheckDefinition, DependencyInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"

async function checkBinaryExists(binary: string): Promise<{ exists: boolean; path: string | null }> {
  try {
    const proc = Bun.spawn(["which", binary], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode === 0) {
      return { exists: true, path: output.trim() }
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

export async function checkCommentChecker(): Promise<DependencyInfo> {
  const binaryCheck = await checkBinaryExists("comment-checker")

  if (!binaryCheck.exists) {
    return {
      name: "Comment Checker",
      required: false,
      installed: false,
      version: null,
      path: null,
      installHint: "Hook will be disabled if not available",
    }
  }

  const version = await getBinaryVersion("comment-checker")

  return {
    name: "Comment Checker",
    required: false,
    installed: true,
    version,
    path: binaryCheck.path,
  }
}

function dependencyToCheckResult(dep: DependencyInfo, checkName: string): CheckResult {
  if (dep.installed) {
    return {
      name: checkName,
      status: "pass",
      message: dep.version ?? "installed",
      details: dep.path ? [`Path: ${dep.path}`] : undefined,
    }
  }

  return {
    name: checkName,
    status: "warn",
    message: "Not installed (optional)",
    details: dep.installHint ? [dep.installHint] : undefined,
  }
}

export async function checkDependencyAstGrepCli(): Promise<CheckResult> {
  const info = await checkAstGrepCli()
  return dependencyToCheckResult(info, CHECK_NAMES[CHECK_IDS.DEP_AST_GREP_CLI])
}

export async function checkDependencyAstGrepNapi(): Promise<CheckResult> {
  const info = await checkAstGrepNapi()
  return dependencyToCheckResult(info, CHECK_NAMES[CHECK_IDS.DEP_AST_GREP_NAPI])
}

export async function checkDependencyCommentChecker(): Promise<CheckResult> {
  const info = await checkCommentChecker()
  return dependencyToCheckResult(info, CHECK_NAMES[CHECK_IDS.DEP_COMMENT_CHECKER])
}

export function getDependencyCheckDefinitions(): CheckDefinition[] {
  return [
    {
      id: CHECK_IDS.DEP_AST_GREP_CLI,
      name: CHECK_NAMES[CHECK_IDS.DEP_AST_GREP_CLI],
      category: "dependencies",
      check: checkDependencyAstGrepCli,
      critical: false,
    },
    {
      id: CHECK_IDS.DEP_AST_GREP_NAPI,
      name: CHECK_NAMES[CHECK_IDS.DEP_AST_GREP_NAPI],
      category: "dependencies",
      check: checkDependencyAstGrepNapi,
      critical: false,
    },
    {
      id: CHECK_IDS.DEP_COMMENT_CHECKER,
      name: CHECK_NAMES[CHECK_IDS.DEP_COMMENT_CHECKER],
      category: "dependencies",
      check: checkDependencyCommentChecker,
      critical: false,
    },
  ]
}
