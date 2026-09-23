import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  COMMENT_CHECKER_RELEASE_VERSION,
  commentCheckerBinaryName,
  resolveCommentCheckerReleaseAsset,
} from "@oh-my-opencode/comment-checker-core"
import {
  cleanupArchive,
  downloadArchive,
  ensureCacheDir,
  ensureExecutable,
  extractTarGz,
  extractZipArchive,
} from "@oh-my-opencode/omo-opencode/binary-downloader"

import { defaultCommentCheckerCacheDir } from "./resolver"
import type { SenpiCommentCheckerDownloadOptions } from "./types"

export async function downloadSenpiCommentCheckerBinary(options: SenpiCommentCheckerDownloadOptions): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const asset = resolveCommentCheckerReleaseAsset(platform, arch)
  if (asset === null) {
    options.logger.warn("omo-senpi comment-checker has no pinned release for this platform", { platform, arch })
    return null
  }

  const cacheDir = options.cacheDir ?? defaultCommentCheckerCacheDir(platform)
  const binaryPath = join(cacheDir, commentCheckerBinaryName(platform))
  if (existsSync(binaryPath)) return binaryPath

  const url = options.resolveAssetUrl?.(asset) ?? asset.url
  const archivePath = join(cacheDir, asset.assetName)
  options.logger.info(`omo-senpi comment-checker: downloading release v${COMMENT_CHECKER_RELEASE_VERSION}`, { url, cacheDir })
  try {
    ensureCacheDir(cacheDir)
    await downloadArchive(url, archivePath)
    if (asset.ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir)
    } else {
      await extractZipArchive(archivePath, cacheDir)
    }
    ensureExecutable(binaryPath)
    if (!existsSync(binaryPath)) {
      options.logger.warn("omo-senpi comment-checker archive did not contain the expected binary", { archivePath, binaryPath })
      return null
    }
    return binaryPath
  } catch (error) {
    options.logger.warn("omo-senpi comment-checker download failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  } finally {
    cleanupArchive(archivePath)
  }
}
