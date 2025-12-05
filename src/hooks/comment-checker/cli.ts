import { spawn } from "bun"
import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync } from "fs"
import * as fs from "fs"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = "/tmp/comment-checker-debug.log"

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    fs.appendFileSync(DEBUG_FILE, msg)
  }
}

type Platform = "darwin" | "linux" | "win32" | "unsupported"

function getPlatformPackageName(): string | null {
  const platform = process.platform as Platform
  const arch = process.arch

  const platformMap: Record<string, string> = {
    "darwin-arm64": "@code-yeongyu/comment-checker-darwin-arm64",
    "darwin-x64": "@code-yeongyu/comment-checker-darwin-x64",
    "linux-arm64": "@code-yeongyu/comment-checker-linux-arm64",
    "linux-x64": "@code-yeongyu/comment-checker-linux-x64",
    "win32-x64": "@code-yeongyu/comment-checker-windows-x64",
  }

  return platformMap[`${platform}-${arch}`] ?? null
}

function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

function findCommentCheckerPath(): string | null {
  const binaryName = getBinaryName()

  // 1. Try to find from @code-yeongyu/comment-checker package
  try {
    const require = createRequire(import.meta.url)
    const cliPkgPath = require.resolve("@code-yeongyu/comment-checker/package.json")
    const cliDir = dirname(cliPkgPath)
    const binaryPath = join(cliDir, "bin", binaryName)

    if (existsSync(binaryPath)) {
      debugLog("found binary in main package:", binaryPath)
      return binaryPath
    }
  } catch {
    debugLog("main package not installed")
  }

  // 2. Try platform-specific package directly (legacy, for backwards compatibility)
  const platformPkg = getPlatformPackageName()
  if (platformPkg) {
    try {
      const require = createRequire(import.meta.url)
      const pkgPath = require.resolve(`${platformPkg}/package.json`)
      const pkgDir = dirname(pkgPath)
      const binaryPath = join(pkgDir, "bin", binaryName)

      if (existsSync(binaryPath)) {
        debugLog("found binary in platform package:", binaryPath)
        return binaryPath
      }
    } catch {
      debugLog("platform package not installed:", platformPkg)
    }
  }

  // 3. Try homebrew installation (macOS)
  if (process.platform === "darwin") {
    const homebrewPaths = [
      "/opt/homebrew/bin/comment-checker",
      "/usr/local/bin/comment-checker",
    ]
    for (const path of homebrewPaths) {
      if (existsSync(path)) {
        debugLog("found binary via homebrew:", path)
        return path
      }
    }
  }

  // 4. Try system PATH
  const systemPath = "comment-checker"
  debugLog("falling back to system PATH:", systemPath)
  return systemPath
}

export const COMMENT_CHECKER_CLI_PATH = findCommentCheckerPath()

export interface HookInput {
  session_id: string
  tool_name: string
  transcript_path: string
  cwd: string
  hook_event_name: string
  tool_input: {
    file_path?: string
    content?: string
    old_string?: string
    new_string?: string
    edits?: Array<{ old_string: string; new_string: string }>
  }
  tool_response?: unknown
}

export interface CheckResult {
  hasComments: boolean
  message: string
}

export async function runCommentChecker(input: HookInput): Promise<CheckResult> {
  if (!COMMENT_CHECKER_CLI_PATH) {
    debugLog("comment-checker binary not found")
    return { hasComments: false, message: "" }
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running comment-checker with input:", jsonInput.substring(0, 200))

  try {
    const proc = spawn([COMMENT_CHECKER_CLI_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    // Write JSON to stdin
    proc.stdin.write(jsonInput)
    proc.stdin.end()

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    debugLog("exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length)

    if (exitCode === 0) {
      return { hasComments: false, message: "" }
    }

    if (exitCode === 2) {
      // Comments detected - message is in stderr
      return { hasComments: true, message: stderr }
    }

    // Error case
    debugLog("unexpected exit code:", exitCode, "stderr:", stderr)
    return { hasComments: false, message: "" }
  } catch (err) {
    debugLog("failed to run comment-checker:", err)
    return { hasComments: false, message: "" }
  }
}

export function isCliAvailable(): boolean {
  return COMMENT_CHECKER_CLI_PATH !== null && existsSync(COMMENT_CHECKER_CLI_PATH)
}
