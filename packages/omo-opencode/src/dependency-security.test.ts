import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "jsonc-parser"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

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
const REPO_ROOT = __repoRootFrom(REPOSITORY_ROOT)
const FIRST_PARTY_SOURCE_PATHS = ["packages", "script", "test-support"] as const

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
  const importPattern =
    String.raw`(?:from\s+["']effect(?:/[^"']*)?["']|import\(\s*["']effect(?:/[^"']*)?["']|require\(\s*["']effect(?:/[^"']*)?["'])`
  const result = Bun.spawnSync(
    [
      "git",
      "grep",
      "-l",
      "-I",
      "-P",
      importPattern,
      "--",
      ...FIRST_PARTY_SOURCE_PATHS,
      ":(glob)**/*.ts",
      ":(exclude)packages/lsp-tools-mcp/**",
      ":(exclude)**/node_modules/**",
      ":(exclude)**/dist/**",
    ],
    // Bound the spawn so a slow `git grep -P` on a loaded Windows runner fails
    // deterministically instead of hanging past the test timeout (the observed flake).
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", timeout: 60_000 },
  )
  expect(
    result.signalCode ?? null,
    `git grep did not finish within the spawn timeout (signal ${result.signalCode})`,
  ).toBeNull()
  if (result.exitCode === 1) return []
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return result.stdout
    .toString()
    .split("\n")
    .filter((path) => path.length > 0)
}

describe("dependency security", () => {
  it("#given picomatch is a runtime dependency #when dependencies are locked #then it uses the patched ReDoS-safe release", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    const bunLock = parse(readFileSync(join(REPO_ROOT, "bun.lock"), "utf-8")) as BunLock
    const dependencyRange = packageJson.dependencies?.picomatch
    const lockedReference = bunLock.packages?.picomatch?.[0]

    expect(dependencyRange).toBe(`^${MINIMUM_SAFE_PICOMATCH_VERSION}`)
    expect(lockedReference).toBeDefined()

    const lockedVersion = extractLockedVersion(lockedReference ?? "")
    expect(compareVersions(lockedVersion, MINIMUM_SAFE_PICOMATCH_VERSION)).toBeGreaterThanOrEqual(0)
    expect(bunLock.workspaces?.[""]?.dependencies?.picomatch).toBe(`^${MINIMUM_SAFE_PICOMATCH_VERSION}`)
  })

  it("#given effect is only needed by OpenCode internals #when root dependencies are locked #then the root package does not depend on effect directly", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    const bunLock = parse(readFileSync(join(REPO_ROOT, "bun.lock"), "utf-8")) as BunLock
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
