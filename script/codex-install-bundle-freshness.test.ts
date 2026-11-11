import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildCodexInstaller,
  bundledWorkspaceSources,
  digestCodexInstallerSources,
  parseCodexInstallerArtifact,
} from "./build-codex-install"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const trackedBundlePath = "packages/omo-codex/scripts/install-dist/install-local.mjs"

// Read from the git index, not the working tree. `bun run test:codex` starts with
// `bun run build:codex-install`, so a working-tree check would be rebuilt into agreement before
// this ever runs and could never fail. The index holds the bytes a clean checkout actually
// executes, and no pre-build step can rewrite them.
function readTrackedBundle(): string {
  const result = Bun.spawnSync(["git", "show", `:${trackedBundlePath}`], { cwd: repositoryRoot })
  if (result.exitCode !== 0) {
    throw new Error(`git show :${trackedBundlePath} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}

// A formatted bundle can keep a self-consistent marker and the same source digest. Only a rebuild
// catches that, and only against the index: test:codex rewrites the working tree first.
function describeBundleMismatch(actual: string, expected: string): string {
  if (actual === expected) return ""
  const actualLines = actual.split("\n")
  const expectedLines = expected.split("\n")
  const limit = Math.max(actualLines.length, expectedLines.length)
  for (let index = 0; index < limit; index++) {
    if (actualLines[index] === expectedLines[index]) continue
    const actualLine = actualLines[index] ?? "<missing>"
    const expectedLine = expectedLines[index] ?? "<missing>"
    return [
      `line ${index + 1} differs (actual ${actualLines.length} lines, expected ${expectedLines.length})`,
      `actual: ${actualLine.slice(0, 200)}`,
      `expected: ${expectedLine.slice(0, 200)}`,
    ].join("\n")
  }
  return `byte length differs: actual ${actual.length}, expected ${expected.length}`
}

describe("committed Codex installer bundle", () => {
  test("#given the tracked bundle #when its build marker is read #then it is present and self-consistent", () => {
    // given
    const artifact = parseCodexInstallerArtifact(readTrackedBundle())

    // when
    const bodyDigest = createHash("sha256")
      .update(artifact?.body ?? "")
      .digest("hex")

    // then
    expect(artifact).toBeDefined()
    expect(artifact?.bodyDigest).toBe(bodyDigest)
  })

  test("#given current installer sources #when compared with the tracked bundle marker #then the bundle is current", async () => {
    // given
    const trackedBundle = readTrackedBundle()
    const artifact = parseCodexInstallerArtifact(trackedBundle)

    // when
    const currentSourceDigest = await digestCodexInstallerSources(bundledWorkspaceSources(trackedBundle))

    // then
    expect({ bundle: trackedBundlePath, sourceDigest: artifact?.sourceDigest }).toEqual({
      bundle: trackedBundlePath,
      sourceDigest: currentSourceDigest,
    })
  })

  test("#given the tracked installer bundle #when it is rebuilt twice into scratch files #then both copies match the tracked bytes", async () => {
    // given
    const tracked = readTrackedBundle()
    const scratch = await mkdtemp(join(tmpdir(), "omo-codex-install-bytes-"))
    const firstPath = join(scratch, "first.mjs")
    const secondPath = join(scratch, "second.mjs")

    try {
      // when
      await buildCodexInstaller({ outputPath: firstPath })
      await buildCodexInstaller({ outputPath: secondPath })
      const first = await readFile(firstPath, "utf8")
      const second = await readFile(secondPath, "utf8")

      // then
      expect(describeBundleMismatch(first, tracked)).toBe("")
      expect(describeBundleMismatch(second, first)).toBe("")
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })
})
