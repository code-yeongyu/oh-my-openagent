import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { extractZip as extractZipBase } from "../../shared"
import { CACHE_DIR_NAME } from "../../shared/plugin-identity"
import {
  cleanupArchive,
  downloadArchive,
  ensureCacheDir,
  ensureExecutable,
  extractTarGz as extractTarGzArchive,
} from "../../shared/binary-downloader"

export function findFileRecursive(dir: string, filename: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true, recursive: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name === filename) {
        return join(entry.parentPath ?? dir, entry.name)
      }
    }
  } catch {
    return null
  }
  return null
}

const RG_VERSION = "14.1.1"

// GitHub Release アセットの既知SHA256ハッシュ（supply chain attack検知用）
// バージョン更新時に実際のリリースアセットからハッシュを計算して更新すること
// ripgrep v14.1.1
const ASSET_SHA256: Record<string, string> = {
  "ripgrep-14.1.1-aarch64-apple-darwin.tar.gz": "24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be",
  "ripgrep-14.1.1-x86_64-apple-darwin.tar.gz": "0000000000000000000000000000000000000000000000000000000000000000", // TODO: actual hash
  "ripgrep-14.1.1-aarch64-unknown-linux-gnu.tar.gz": "0000000000000000000000000000000000000000000000000000000000000000", // TODO: actual hash
  "ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz": "0000000000000000000000000000000000000000000000000000000000000000", // TODO: actual hash
  "ripgrep-14.1.1-x86_64-pc-windows-msvc.zip": "0000000000000000000000000000000000000000000000000000000000000000", // TODO: actual hash
}

const PLATFORM_CONFIG: Record<string, { platform: string; extension: "tar.gz" | "zip" } | undefined> = {
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
  "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
}

function getPlatformKey(): string {
  return `${process.arch}-${process.platform}`
}

function getInstallDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "."
  return join(homeDir, ".cache", CACHE_DIR_NAME, "bin")
}

function getRgPath(): string {
  const isWindows = process.platform === "win32"
  return join(getInstallDir(), isWindows ? "rg.exe" : "rg")
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const platformKey = getPlatformKey()

  const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

  if (platformKey.endsWith("-darwin")) {
    args.push("--include=*/rg")
  } else if (platformKey.endsWith("-linux")) {
    args.push("--wildcards", "*/rg")
  }

  await extractTarGzArchive(archivePath, destDir, { args, cwd: destDir })
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  await extractZipBase(archivePath, destDir)

  const binaryName = process.platform === "win32" ? "rg.exe" : "rg"
  const foundPath = findFileRecursive(destDir, binaryName)
  if (foundPath) {
    const destPath = join(destDir, binaryName)
    if (foundPath !== destPath) {
      const { renameSync } = await import("node:fs")
      renameSync(foundPath, destPath)
    }
  }
}

export async function downloadAndInstallRipgrep(): Promise<string> {
  const platformKey = getPlatformKey()
  const config = PLATFORM_CONFIG[platformKey]

  if (!config) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  const installDir = getInstallDir()
  const rgPath = getRgPath()

  if (existsSync(rgPath)) {
    return rgPath
  }

  ensureCacheDir(installDir)

  const filename = `ripgrep-${RG_VERSION}-${config.platform}.${config.extension}`
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${filename}`
  const archivePath = join(installDir, filename)

  const expectedSha256 = ASSET_SHA256[filename]

  try {
    await downloadArchive(url, archivePath, { expectedSha256 })

    if (config.extension === "tar.gz") {
      await extractTarGz(archivePath, installDir)
    } else {
      await extractZip(archivePath, installDir)
    }

    ensureExecutable(rgPath)

    if (!existsSync(rgPath)) {
      throw new Error("ripgrep binary not found after extraction")
    }

    return rgPath
  } finally {
    try {
      cleanupArchive(archivePath)
    } catch {
      // Cleanup failures are non-critical
    }
  }
}

export function getInstalledRipgrepPath(): string | null {
  const rgPath = getRgPath()
  return existsSync(rgPath) ? rgPath : null
}
