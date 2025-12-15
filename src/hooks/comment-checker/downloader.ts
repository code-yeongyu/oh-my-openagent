import { spawn } from "bun"
import { existsSync, mkdirSync, chmodSync, unlinkSync, appendFileSync } from "fs"
import { join } from "path"
import { homedir, tmpdir } from "os"
import { createRequire } from "module"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:downloader] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    appendFileSync(DEBUG_FILE, msg)
  }
}

const REPO = "code-yeongyu/go-claude-code-comment-checker"

interface PlatformInfo {
  os: string
  arch: string
  ext: "tar.gz" | "zip"
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  "darwin-arm64": { os: "darwin", arch: "arm64", ext: "tar.gz" },
  "darwin-x64": { os: "darwin", arch: "amd64", ext: "tar.gz" },
  "linux-arm64": { os: "linux", arch: "arm64", ext: "tar.gz" },
  "linux-x64": { os: "linux", arch: "amd64", ext: "tar.gz" },
  "win32-x64": { os: "windows", arch: "amd64", ext: "zip" },
}

/**
 * Get the cache directory for oh-my-opencode binaries.
 * Follows XDG Base Directory Specification.
 */
export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME
  const base = xdgCache || join(homedir(), ".cache")
  return join(base, "oh-my-opencode", "bin")
}

/**
 * Get the binary name based on platform.
 */
export function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

/**
 * Get the cached binary path if it exists.
 */
export function getCachedBinaryPath(): string | null {
  const binaryPath = join(getCacheDir(), getBinaryName())
  return existsSync(binaryPath) ? binaryPath : null
}

/**
 * Get the version from the installed @code-yeongyu/comment-checker package.
 */
function getPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require("@code-yeongyu/comment-checker/package.json")
    return pkg.version
  } catch {
    // Fallback to hardcoded version if package not found
    return "0.4.1"
  }
}

/**
 * Extract tar.gz archive using system tar command.
 */
async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  debugLog("Extracting tar.gz:", archivePath, "to", destDir)
  
  const proc = spawn(["tar", "-xzf", archivePath, "-C", destDir], {
    stdout: "pipe",
    stderr: "pipe",
  })
  
  const exitCode = await proc.exited
  
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`tar extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

/**
 * Extract zip archive using system commands.
 */
async function extractZip(archivePath: string, destDir: string): Promise<void> {
  debugLog("Extracting zip:", archivePath, "to", destDir)
  
  const proc = process.platform === "win32"
    ? spawn(["powershell", "-command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`], {
        stdout: "pipe",
        stderr: "pipe",
      })
    : spawn(["unzip", "-o", archivePath, "-d", destDir], {
        stdout: "pipe",
        stderr: "pipe",
      })
  
  const exitCode = await proc.exited
  
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

/**
 * Download the comment-checker binary from GitHub Releases.
 * Returns the path to the downloaded binary, or null on failure.
 */
export async function downloadCommentChecker(): Promise<string | null> {
  const platformKey = `${process.platform}-${process.arch}`
  const platformInfo = PLATFORM_MAP[platformKey]
  
  if (!platformInfo) {
    debugLog(`Unsupported platform: ${platformKey}`)
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
  
  const version = getPackageVersion()
  const { os, arch, ext } = platformInfo
  const assetName = `comment-checker_v${version}_${os}_${arch}.${ext}`
  const downloadUrl = `https://github.com/${REPO}/releases/download/v${version}/${assetName}`
  
  debugLog(`Downloading from: ${downloadUrl}`)
  console.log(`[oh-my-opencode] Downloading comment-checker binary...`)
  
  try {
    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }
    
    // Download with fetch() - Bun handles redirects automatically
    const response = await fetch(downloadUrl, { redirect: "follow" })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const archivePath = join(cacheDir, assetName)
    const arrayBuffer = await response.arrayBuffer()
    await Bun.write(archivePath, arrayBuffer)
    
    debugLog(`Downloaded archive to: ${archivePath}`)
    
    // Extract based on file type
    if (ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir)
    } else {
      await extractZip(archivePath, cacheDir)
    }
    
    // Clean up archive
    if (existsSync(archivePath)) {
      unlinkSync(archivePath)
    }
    
    // Set execute permission on Unix
    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 0o755)
    }
    
    debugLog(`Successfully downloaded binary to: ${binaryPath}`)
    console.log(`[oh-my-opencode] comment-checker binary ready.`)
    
    return binaryPath
    
  } catch (err) {
    debugLog(`Failed to download: ${err}`)
    console.error(`[oh-my-opencode] Failed to download comment-checker: ${err instanceof Error ? err.message : err}`)
    console.error(`[oh-my-opencode] Comment checking disabled.`)
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
