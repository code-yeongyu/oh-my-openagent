import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "jsonc-parser"

type BunLock = {
  workspaces?: {
    ""?: {
      dependencies?: Record<string, string>
    }
  }
  packages?: Record<string, [string, ...unknown[]]>
}

const MINIMUM_SAFE_PICOMATCH_VERSION = "4.0.4"

function parseVersion(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".")
  return [Number(major), Number(minor), Number(patch)]
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)

  for (let index = 0; index < leftParts.length; index++) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

function extractLockedVersion(packageReference: string): string {
  const versionSeparatorIndex = packageReference.lastIndexOf("@")

  if (versionSeparatorIndex === -1) {
    return packageReference
  }

  return packageReference.slice(versionSeparatorIndex + 1)
}

describe("dependency security", () => {
  it("#given picomatch is a runtime dependency #when dependencies are locked #then it uses the patched ReDoS-safe release", () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    const bunLock = parse(readFileSync(join(import.meta.dir, "..", "bun.lock"), "utf-8")) as BunLock
    const dependencyRange = packageJson.dependencies?.picomatch
    const lockedReference = bunLock.packages?.picomatch?.[0]

    expect(dependencyRange).toBe(`^${MINIMUM_SAFE_PICOMATCH_VERSION}`)
    expect(lockedReference).toBeDefined()

    const lockedVersion = extractLockedVersion(lockedReference ?? "")
    expect(compareVersions(lockedVersion, MINIMUM_SAFE_PICOMATCH_VERSION)).toBeGreaterThanOrEqual(0)
    expect(bunLock.workspaces?.[""]?.dependencies?.picomatch).toBe(`^${MINIMUM_SAFE_PICOMATCH_VERSION}`)
  })
})
