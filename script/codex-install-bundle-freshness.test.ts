import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

import { digestCodexInstallerSources, parseCodexInstallerArtifact } from "./build-codex-install"

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

describe("committed Codex installer bundle", () => {
  test("#given the tracked bundle #when its build marker is read #then it is present and self-consistent", () => {
    // given
    const artifact = parseCodexInstallerArtifact(readTrackedBundle())

    // when
    const bodyDigest = createHash("sha256").update(artifact?.body ?? "").digest("hex")

    // then
    expect(artifact).toBeDefined()
    expect(artifact?.bodyDigest).toBe(bodyDigest)
  })

  test("#given current installer sources #when compared with the tracked bundle marker #then the bundle is current", async () => {
    // given
    const artifact = parseCodexInstallerArtifact(readTrackedBundle())

    // when
    const currentSourceDigest = await digestCodexInstallerSources()

    // then
    expect({ bundle: trackedBundlePath, sourceDigest: artifact?.sourceDigest }).toEqual({
      bundle: trackedBundlePath,
      sourceDigest: currentSourceDigest,
    })
  })
})
