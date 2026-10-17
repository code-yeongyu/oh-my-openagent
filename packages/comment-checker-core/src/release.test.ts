import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import {
  COMMENT_CHECKER_RELEASE_VERSION,
  commentCheckerBinaryName,
  commentCheckerCacheDir,
  resolveCommentCheckerReleaseAsset,
} from "./release"

const RELEASE_BASE = "https://github.com/code-yeongyu/go-claude-code-comment-checker/releases/download/v0.8.0/"

describe("comment-checker release descriptor", () => {
  it("#given the pinned version #when read #then it is 0.8.0", () => {
    expect(COMMENT_CHECKER_RELEASE_VERSION).toBe("0.8.0")
  })

  it.each([
    ["darwin", "arm64", "comment-checker_v0.8.0_darwin_arm64.tar.gz", "tar.gz"],
    ["darwin", "x64", "comment-checker_v0.8.0_darwin_amd64.tar.gz", "tar.gz"],
    ["linux", "arm64", "comment-checker_v0.8.0_linux_arm64.tar.gz", "tar.gz"],
    ["linux", "x64", "comment-checker_v0.8.0_linux_amd64.tar.gz", "tar.gz"],
    ["win32", "x64", "comment-checker_v0.8.0_windows_amd64.zip", "zip"],
  ] as const)("#given %s/%s #when resolving the asset #then it names %s", (platform, arch, assetName, ext) => {
    const asset = resolveCommentCheckerReleaseAsset(platform, arch)
    expect(asset).toEqual({
      os: assetName.split("_")[2],
      arch: assetName.split("_")[3]?.split(".")[0],
      ext,
      assetName,
      url: `${RELEASE_BASE}${assetName}`,
    })
  })

  it("#given an unsupported platform #when resolving the asset #then there is none", () => {
    expect(resolveCommentCheckerReleaseAsset("freebsd", "x64")).toBeNull()
    expect(resolveCommentCheckerReleaseAsset("win32", "arm64")).toBeNull()
  })

  it("#given a different version #when resolving the asset #then the version threads into name and url", () => {
    const asset = resolveCommentCheckerReleaseAsset("linux", "x64", "9.9.9")
    expect(asset?.assetName).toBe("comment-checker_v9.9.9_linux_amd64.tar.gz")
    expect(asset?.url).toContain("/releases/download/v9.9.9/")
  })

  it("#given each platform #when naming the binary #then only win32 carries .exe", () => {
    expect(commentCheckerBinaryName("win32")).toBe("comment-checker.exe")
    expect(commentCheckerBinaryName("darwin")).toBe("comment-checker")
    expect(commentCheckerBinaryName("linux")).toBe("comment-checker")
  })

  it("#given XDG_CACHE_HOME on posix #when locating the cache #then it is <xdg>/<name>/bin", () => {
    const dir = commentCheckerCacheDir({ platform: "linux", env: { XDG_CACHE_HOME: "/xdg" }, homedir: "/home/u", cacheDirName: "oh-my-opencode" })
    expect(dir).toBe(join("/xdg", "oh-my-opencode", "bin"))
  })

  it("#given no XDG_CACHE_HOME on posix #when locating the cache #then it falls back to ~/.cache", () => {
    const dir = commentCheckerCacheDir({ platform: "darwin", env: {}, homedir: "/Users/u", cacheDirName: "oh-my-opencode" })
    expect(dir).toBe(join("/Users/u", ".cache", "oh-my-opencode", "bin"))
  })

  it("#given win32 #when locating the cache #then LOCALAPPDATA wins, then APPDATA, then AppData\\Local", () => {
    const name = "oh-my-opencode"
    expect(commentCheckerCacheDir({ platform: "win32", env: { LOCALAPPDATA: "L", APPDATA: "A" }, homedir: "H", cacheDirName: name })).toBe(join("L", name, "bin"))
    expect(commentCheckerCacheDir({ platform: "win32", env: { APPDATA: "A" }, homedir: "H", cacheDirName: name })).toBe(join("A", name, "bin"))
    expect(commentCheckerCacheDir({ platform: "win32", env: {}, homedir: "H", cacheDirName: name })).toBe(join("H", "AppData", "Local", name, "bin"))
  })
})
