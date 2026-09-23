import { existsSync, appendFileSync } from "fs"
import { join } from "path"
import { homedir, tmpdir } from "os"
import {
  commentCheckerBinaryName,
  commentCheckerCacheDir,
  resolveCommentCheckerReleaseAsset,
} from "@oh-my-opencode/comment-checker-core"
import {
  cleanupArchive,
  downloadArchive,
  ensureCacheDir,
  ensureExecutable,
  extractTarGz,
  extractZipArchive,
  getCachedBinaryPath as getCachedBinaryPathShared,
} from "../../shared/binary-downloader"
import { log } from "../../shared/logger"
import { CACHE_DIR_NAME, PUBLISHED_PACKAGE_NAME } from "../../shared/plugin-identity"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:downloader] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    appendFileSync(DEBUG_FILE, msg)
  }
}

/**
 * Get the cache directory for oh-my-opencode binaries.
 * On Windows: Uses %LOCALAPPDATA% or %APPDATA% (Windows conventions)
 * On Unix: Follows XDG Base Directory Specification
 */
export function getCacheDir(): string {
  return commentCheckerCacheDir({
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    cacheDirName: CACHE_DIR_NAME,
  })
}

/**
 * Get the binary name based on platform.
 */
export function getBinaryName(): string {
  return commentCheckerBinaryName(process.platform)
}

/**
 * Get the cached binary path if it exists.
 */
export function getCachedBinaryPath(): string | null {
  return getCachedBinaryPathShared(getCacheDir(), getBinaryName())
}

/**
 * Download the comment-checker binary from GitHub Releases.
 * Returns the path to the downloaded binary, or null on failure.
 */
export async function downloadCommentChecker(): Promise<string | null> {
  const asset = resolveCommentCheckerReleaseAsset(process.platform, process.arch)
  
  if (!asset) {
    debugLog(`Unsupported platform: ${process.platform}-${process.arch}`)
    return null
  }
  
  const cacheDir = getCacheDir()
  const binaryName = getBinaryName()
  const binaryPath = join(cacheDir, binaryName)
  
  // Already exists in cache
  if (existsSync(binaryPath)) {
    debugLog("Binary already cached at:", binaryPath)
    return binaryPath
  }
  
  const { assetName, url: downloadUrl, ext } = asset
  
  debugLog(`Downloading from: ${downloadUrl}`)
  log(`[${PUBLISHED_PACKAGE_NAME}] Downloading comment-checker binary...`)
  
  try {
    // Ensure cache directory exists
    ensureCacheDir(cacheDir)
    
    const archivePath = join(cacheDir, assetName)
    await downloadArchive(downloadUrl, archivePath)
    
    debugLog(`Downloaded archive to: ${archivePath}`)
    
    // Extract based on file type
    if (ext === "tar.gz") {
      debugLog("Extracting tar.gz:", archivePath, "to", cacheDir)
      await extractTarGz(archivePath, cacheDir)
    } else {
      await extractZipArchive(archivePath, cacheDir)
    }
    
    // Clean up archive
    cleanupArchive(archivePath)
    
    // Set execute permission on Unix
    ensureExecutable(binaryPath)
    
    debugLog(`Successfully downloaded binary to: ${binaryPath}`)
    log(`[${PUBLISHED_PACKAGE_NAME}] comment-checker binary ready.`)
    
    return binaryPath
    
  } catch (err) {
    debugLog(`Failed to download: ${err}`)
    log(`[${PUBLISHED_PACKAGE_NAME}] Failed to download comment-checker: ${err instanceof Error ? err.message : err}`)
    log(`[${PUBLISHED_PACKAGE_NAME}] Comment checking disabled.`)
    return null
  }
}

/**
 * Ensure the comment-checker binary is available.
 * First checks cache, then downloads if needed.
 * Returns the binary path or null if unavailable.
 */
export async function ensureCommentCheckerBinary(): Promise<string | null> {
  // Check cache first
  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    debugLog("Using cached binary:", cachedPath)
    return cachedPath
  }
  
  // Download if not cached
  return downloadCommentChecker()
}
