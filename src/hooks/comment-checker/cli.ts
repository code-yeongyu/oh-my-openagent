import { spawn } from "../../shared/bun-spawn-shim"
import { join } from "path"
import { existsSync } from "fs"
import * as fs from "fs"
import { tmpdir } from "os"
import {
  resolveCommentCheckerBinary,
  runCommentChecker as runCommentCheckerCore,
  type CheckResult,
  type HookInput,
} from "@oh-my-opencode/comment-checker-core"
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

/**
 * PATH lookup hook. Defaults to `Bun.which`, mirroring how the doctor
 * dependency check resolves `comment-checker` (`src/cli/doctor/checks/
 * dependencies.ts`). Exposed as a parameter so tests can inject a
 * deterministic mock. #3315.
 */
export type WhichFn = (command: string) => string | null | undefined

function findCommentCheckerPathSync(which: WhichFn = Bun.which): string | null {
  const resolvedPath = resolveCommentCheckerBinary({
    binaryName: getBinaryName(),
    cachedBinaryPath: getCachedBinaryPath(),
    existsSync,
    importMetaUrl: import.meta.url,
  })
  if (resolvedPath !== null) {
    debugLog("resolved binary path:", resolvedPath)
    return resolvedPath
  }

  // Fall back to PATH lookup so users who install via `npm install -g
  // @code-yeongyu/comment-checker` (binary lands in PATH) match the same
  // outcome doctor already reports — without this, doctor said "System OK"
  // but the hook silently no-op'd because the resolver only checked the
  // cached download path and the package-local `bin/` directory. #3315.
  try {
    const pathBinary = which(getBinaryName())
    if (pathBinary && existsSync(pathBinary)) {
      debugLog("resolved binary via PATH lookup:", pathBinary)
      return pathBinary
    }
  } catch {
    // Bun.which can throw on some platforms; treat as "not found".
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
 * Test-only entry point for the binary resolver. Lets unit tests assert the
 * `cached → package-local → PATH` lookup order (#3315) without monkey-patching
 * `Bun.which` globally. Not part of the public API surface; do not call from
 * production code.
 */
export function __resolveCommentCheckerBinaryForTesting(which: WhichFn): string | null {
  return findCommentCheckerPathSync(which)
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

export type { HookInput, CheckResult }

/**
 * Run comment-checker CLI with given input.
 * @param input Hook input to check
 * @param cliPath Optional explicit path to CLI binary
 * @param customPrompt Optional custom prompt to replace default warning message
 */
export async function runCommentChecker(input: HookInput, cliPath?: string, customPrompt?: string): Promise<CheckResult> {
  const binaryPath = cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()

  if (!binaryPath) {
    debugLog("comment-checker binary not found")
    return { hasComments: false, message: "" }
  }

  try {
    const result = await runCommentCheckerCore(
      { hookInput: input, binaryPath, customPrompt },
      {
        existsSync,
        spawn: (args: readonly string[]) =>
          spawn([...args], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          }),
      },
    )
    return result
  } catch (error) {
    debugLog("failed to run comment-checker:", error)
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
