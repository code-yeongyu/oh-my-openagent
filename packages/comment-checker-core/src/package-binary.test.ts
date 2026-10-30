import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findCommentCheckerPackageBinary } from "./package-binary"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function installRoot(): { readonly root: string; readonly packageJsonPath: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "comment-checker-package-binary-")))
  roots.push(root)
  const packageDir = join(root, "node_modules", "@code-yeongyu", "comment-checker")
  mkdirSync(packageDir, { recursive: true })
  const packageJsonPath = join(packageDir, "package.json")
  writeFileSync(packageJsonPath, JSON.stringify({ name: "@code-yeongyu/comment-checker" }))
  return { root, packageJsonPath }
}

function writeFile(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "")
  return path
}

function writePlatformPackage(root: string, platformKey: string, binaryName: string): string {
  const packageDir = join(root, "node_modules", "@code-yeongyu", `comment-checker-${platformKey}`)
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: `@code-yeongyu/comment-checker-${platformKey}` }))
  return writeFile(join(packageDir, "bin", binaryName))
}

describe("findCommentCheckerPackageBinary", () => {
  it("#given the per-platform package and a legacy vendor copy #when resolving #then the platform package wins", () => {
    // given
    const { root, packageJsonPath } = installRoot()
    writeFile(join(packageJsonPath, "..", "vendor", "linux-arm64", "comment-checker"))
    const platformBinary = writePlatformPackage(root, "linux-arm64", "comment-checker")

    // when
    const resolved = findCommentCheckerPackageBinary({
      packageJsonPath, binaryName: "comment-checker", existsSync, platform: "linux", arch: "arm64",
    })

    // then
    expect(resolved).toBe(platformBinary)
  })

  it("#given only the 0.7.1-0.8.x bundled layout #when resolving #then the vendor binary resolves", () => {
    // given
    const { packageJsonPath } = installRoot()
    const vendorBinary = writeFile(join(packageJsonPath, "..", "vendor", "win32-x64", "comment-checker.exe"))

    // when
    const resolved = findCommentCheckerPackageBinary({
      packageJsonPath, binaryName: "comment-checker.exe", existsSync, platform: "win32", arch: "x64",
    })

    // then
    expect(resolved).toBe(vendorBinary)
  })

  it("#given only another platform's package and a postinstall binary #when resolving #then the postinstall binary resolves", () => {
    // given
    const { root, packageJsonPath } = installRoot()
    writePlatformPackage(root, "darwin-x64", "comment-checker")
    const postinstallBinary = writeFile(join(packageJsonPath, "..", "bin", "comment-checker"))

    // when
    const resolved = findCommentCheckerPackageBinary({
      packageJsonPath, binaryName: "comment-checker", existsSync, platform: "darwin", arch: "arm64",
    })

    // then
    expect(resolved).toBe(postinstallBinary)
  })

  it("#given the package without any binary #when resolving #then nothing resolves", () => {
    // given
    const { packageJsonPath } = installRoot()

    // when
    const resolved = findCommentCheckerPackageBinary({
      packageJsonPath, binaryName: "comment-checker", existsSync, platform: "linux", arch: "x64",
    })

    // then
    expect(resolved).toBeNull()
  })
})
