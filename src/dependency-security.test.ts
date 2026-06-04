import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
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
const REPOSITORY_ROOT = dirname(fileURLToPath(import.meta.url))
const FIRST_PARTY_SOURCE_GLOBS = [
  "src/**/*.ts",
  "packages/**/*.ts",
  "script/**/*.ts",
  "test-support/**/*.ts",
] as const

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

async function findFirstPartyEffectImports(): Promise<string[]> {
  const matches: string[] = []
  const importPattern = /(?:from\s+["']effect(?:\/[^"']*)?["']|import\(\s*["']effect(?:\/[^"']*)?["']|require\(\s*["']effect(?:\/[^"']*)?["'])/

  for (const globPattern of FIRST_PARTY_SOURCE_GLOBS) {
    const glob = new Bun.Glob(globPattern)
    for await (const filePath of glob.scan({ cwd: join(REPOSITORY_ROOT, ".."), onlyFiles: true })) {
      const source = await Bun.file(join(REPOSITORY_ROOT, "..", filePath)).text()
      if (importPattern.test(source)) {
        matches.push(filePath)
      }
    }
  }

  return matches
}

describe("dependency security", () => {
  it("#given picomatch is a runtime dependency #when dependencies are locked #then it uses the patched ReDoS-safe release", () => {
    const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "..", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    const bunLock = parse(readFileSync(join(REPOSITORY_ROOT, "..", "bun.lock"), "utf-8")) as BunLock
    const dependencyRange = packageJson.dependencies?.picomatch
    const lockedReference = bunLock.packages?.picomatch?.[0]

    expect(dependencyRange).toBe(`^${MINIMUM_SAFE_PICOMATCH_VERSION}`)
    expect(lockedReference).toBeDefined()

    const lockedVersion = extractLockedVersion(lockedReference ?? "")
    expect(compareVersions(lockedVersion, MINIMUM_SAFE_PICOMATCH_VERSION)).toBeGreaterThanOrEqual(0)
    expect(bunLock.workspaces?.[""]?.dependencies?.picomatch).toBe(`^${MINIMUM_SAFE_PICOMATCH_VERSION}`)
  })

  it("#given effect is only needed by OpenCode internals #when root dependencies are locked #then the root package does not depend on effect directly", () => {
    const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "..", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    const bunLock = parse(readFileSync(join(REPOSITORY_ROOT, "..", "bun.lock"), "utf-8")) as BunLock
    const opencodePluginDependencies = bunLock.packages?.["@opencode-ai/plugin"]?.[2]

    expect(packageJson.dependencies?.effect).toBeUndefined()
    expect(bunLock.workspaces?.[""]?.dependencies?.effect).toBeUndefined()
    expect(opencodePluginDependencies).toMatchObject({
      dependencies: expect.objectContaining({ effect: expect.any(String) }),
    })
    expect(bunLock.packages?.effect?.[0]).toBe("effect@4.0.0-beta.66")
  })

  it("#given first-party TypeScript sources #when dependency imports are scanned #then no source imports effect directly", async () => {
    const effectImports = await findFirstPartyEffectImports()

    expect(effectImports).toEqual([])
  })
})
