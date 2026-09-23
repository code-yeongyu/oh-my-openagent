import { join } from "node:path"

/** Release pin: https://github.com/code-yeongyu/go-claude-code-comment-checker/releases */
export const COMMENT_CHECKER_RELEASE_VERSION = "0.8.0"
export const COMMENT_CHECKER_RELEASE_REPO = "code-yeongyu/go-claude-code-comment-checker"

export type CommentCheckerArchiveExtension = "tar.gz" | "zip"

export interface CommentCheckerReleaseAsset {
  readonly os: string
  readonly arch: string
  readonly ext: CommentCheckerArchiveExtension
  readonly assetName: string
  readonly url: string
}

interface ReleasePlatform {
  readonly os: string
  readonly arch: string
  readonly ext: CommentCheckerArchiveExtension
}

const RELEASE_PLATFORMS: Readonly<Record<string, ReleasePlatform>> = {
  "darwin-arm64": { os: "darwin", arch: "arm64", ext: "tar.gz" },
  "darwin-x64": { os: "darwin", arch: "amd64", ext: "tar.gz" },
  "linux-arm64": { os: "linux", arch: "arm64", ext: "tar.gz" },
  "linux-x64": { os: "linux", arch: "amd64", ext: "tar.gz" },
  "win32-x64": { os: "windows", arch: "amd64", ext: "zip" },
}

export function resolveCommentCheckerReleaseAsset(
  platform: string,
  arch: string,
  version: string = COMMENT_CHECKER_RELEASE_VERSION,
): CommentCheckerReleaseAsset | null {
  const target = RELEASE_PLATFORMS[`${platform}-${arch}`]
  if (target === undefined) return null
  const assetName = `comment-checker_v${version}_${target.os}_${target.arch}.${target.ext}`
  return {
    os: target.os,
    arch: target.arch,
    ext: target.ext,
    assetName,
    url: `https://github.com/${COMMENT_CHECKER_RELEASE_REPO}/releases/download/v${version}/${assetName}`,
  }
}

export function commentCheckerBinaryName(platform: string): string {
  return platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

export interface CommentCheckerCacheDirInput {
  readonly platform: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homedir: string
  readonly cacheDirName: string
}

/** `%LOCALAPPDATA%\<name>\bin` on Windows, `$XDG_CACHE_HOME/<name>/bin` (default `~/.cache`) elsewhere. */
export function commentCheckerCacheDir(input: CommentCheckerCacheDirInput): string {
  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA || input.env.APPDATA
    const base = localAppData || join(input.homedir, "AppData", "Local")
    return join(base, input.cacheDirName, "bin")
  }
  const base = input.env.XDG_CACHE_HOME || join(input.homedir, ".cache")
  return join(base, input.cacheDirName, "bin")
}
