import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createRequire } from "module"
import {
  cleanupArchive,
  downloadArchive,
  ensureCacheDir,
  ensureExecutable,
  extractZipArchive,
  getCachedBinaryPath as getCachedBinaryPathShared,
} from "../../shared/binary-downloader"
import { log } from "../../shared/logger"

const REPO = "ast-grep/ast-grep"

// IMPORTANT: Update this when bumping @ast-grep/cli in package.json
// This is only used as fallback when @ast-grep/cli package.json cannot be read
const DEFAULT_VERSION = "0.40.0"

function getAstGrepVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require("@ast-grep/cli/package.json")
    return pkg.version
  } catch {
    return DEFAULT_VERSION
  }
}

interface PlatformInfo {
  arch: string
  os: string
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  "darwin-arm64": { arch: "aarch64", os: "apple-darwin" },
  "darwin-x64": { arch: "x86_64", os: "apple-darwin" },
  "linux-arm64": { arch: "aarch64", os: "unknown-linux-gnu" },
  "linux-x64": { arch: "x86_64", os: "unknown-linux-gnu" },
  "win32-x64": { arch: "x86_64", os: "pc-windows-msvc" },
  "win32-arm64": { arch: "aarch64", os: "pc-windows-msvc" },
  "win32-ia32": { arch: "i686", os: "pc-windows-msvc" },
}

export function getCacheDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA
    const base = localAppData || join(homedir(), "AppData", "Local")
    return join(base, "oh-my-opencode", "bin")
  }

  const xdgCache = process.env.XDG_CACHE_HOME
  const base = xdgCache || join(homedir(), ".cache")
  return join(base, "oh-my-opencode", "bin")
}

export function getBinaryName(): string {
  return process.platform === "win32" ? "sg.exe" : "sg"
}

export function getCachedBinaryPath(): string | null {
  return getCachedBinaryPathShared(getCacheDir(), getBinaryName())
}



export async function downloadAstGrep(version: string = DEFAULT_VERSION): Promise<string | null> {
  const platformKey = `${process.platform}-${process.arch}`
  const platformInfo = PLATFORM_MAP[platformKey]

  if (!platformInfo) {
    log(`[oh-my-opencode] Unsupported platform for ast-grep: ${platformKey}`)
    return null
  }

  const cacheDir = getCacheDir()
  const binaryName = getBinaryName()
  const binaryPath = join(cacheDir, binaryName)

  if (existsSync(binaryPath)) {
    return binaryPath
  }

  const { arch, os } = platformInfo
  const assetName = `app-${arch}-${os}.zip`
  const downloadUrl = `https://github.com/${REPO}/releases/download/${version}/${assetName}`

  log(`[oh-my-opencode] Downloading ast-grep binary...`)

  try {
    const archivePath = join(cacheDir, assetName)
    ensureCacheDir(cacheDir)
    await downloadArchive(downloadUrl, archivePath)
    await extractZipArchive(archivePath, cacheDir)
    cleanupArchive(archivePath)
    ensureExecutable(binaryPath)

    log(`[oh-my-opencode] ast-grep binary ready.`)

    return binaryPath
  } catch (err) {
    log(
      `[oh-my-opencode] Failed to download ast-grep: ${err instanceof Error ? err.message : err}`
    )
    return null
  }
}

export async function ensureAstGrepBinary(): Promise<string | null> {
  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    return cachedPath
  }

  const version = getAstGrepVersion()
  return downloadAstGrep(version)
}
