import { spawn } from "bun"
import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync } from "fs"
import * as fs from "fs"
import { tmpdir } from "os"
import { getCachedBinaryPath, ensureCommentCheckerBinary } from "./downloader"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    fs.appendFileSync(DEBUG_FILE, msg)
  }
}

function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

function findCommentCheckerPathSync(): string | null {
  const binaryName = getBinaryName()

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

  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    debugLog("found binary in cache:", cachedPath)
    return cachedPath
  }

  debugLog("no binary found in known locations")
  return null
}

// Cached resolved path
let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

/**
 * Asynchronously get comment-checker binary path.
 * Will trigger lazy download if binary not found.
 */
export async function getCommentCheckerPath(): Promise<string | null> {
  // Return cached path if already resolved
  if (resolvedCliPath !== null) {
    return resolvedCliPath
  }

  // Return existing promise if initialization is in progress
  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    // First try sync path resolution
    const syncPath = findCommentCheckerPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath
      debugLog("using sync-resolved path:", syncPath)
      return syncPath
    }

    // Lazy download if not found
    debugLog("triggering lazy download...")
    const downloadedPath = await ensureCommentCheckerBinary()
    if (downloadedPath) {
      resolvedCliPath = downloadedPath
      debugLog("using downloaded path:", downloadedPath)
      return downloadedPath
    }

    debugLog("no binary available")
    return null
  })()

  return initPromise
}

/**
 * Synchronously get comment-checker path (no download).
 * Returns cached path or searches known locations.
 */
export function getCommentCheckerPathSync(): string | null {
  return resolvedCliPath ?? findCommentCheckerPathSync()
}

/**
 * Start background initialization.
 * Call this early to trigger download while other init happens.
 */
export function startBackgroundInit(): void {
  if (!initPromise) {
    initPromise = getCommentCheckerPath()
    initPromise.then(path => {
      debugLog("background init complete:", path || "no binary")
    }).catch(err => {
      debugLog("background init error:", err)
    })
  }
}

// Legacy export for backwards compatibility (sync, no download)
export const COMMENT_CHECKER_CLI_PATH = findCommentCheckerPathSync()

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

/**
 * Run comment-checker CLI with given input.
 * @param input Hook input to check
 * @param cliPath Optional explicit path to CLI binary
 */
export async function runCommentChecker(input: HookInput, cliPath?: string): Promise<CheckResult> {
  const binaryPath = cliPath ?? resolvedCliPath ?? COMMENT_CHECKER_CLI_PATH
  
  if (!binaryPath) {
    debugLog("comment-checker binary not found")
    return { hasComments: false, message: "" }
  }

  if (!existsSync(binaryPath)) {
    debugLog("comment-checker binary does not exist:", binaryPath)
    return { hasComments: false, message: "" }
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running comment-checker with input:", jsonInput.substring(0, 200))

  try {
    const proc = spawn([binaryPath], {
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

/**
 * Check if CLI is available (sync check, no download).
 */
export function isCliAvailable(): boolean {
  const path = getCommentCheckerPathSync()
  return path !== null && existsSync(path)
}

/**
 * Check if CLI will be available (async, may trigger download).
 */
export async function ensureCliAvailable(): Promise<boolean> {
  const path = await getCommentCheckerPath()
  return path !== null && existsSync(path)
}
