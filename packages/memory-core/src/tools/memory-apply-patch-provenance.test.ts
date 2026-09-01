import { afterEach, describe, expect, it } from "bun:test"
import { join } from "node:path"

import { runMemoryApplyPatch } from "./memory-apply-patch"
import {
  author,
  createPatchFixtureHarness,
  git,
  memoryApplyPatch,
  params,
} from "./memory-apply-patch.test-support"

const { fixture, cleanup } = createPatchFixtureHarness()

afterEach(cleanup)

const MEMORY_GIT_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

describe("memoryApplyPatch provenance and locks", () => {
  it("#given accepted-turn provenance #when a patch commits #then the in-band writer session and turn trailers are durable", async () => {
    // given
    const { repo, locksDirectory } = await fixture()
    const input = "*** Begin Patch\n*** Add File: provenance.md\n+fact\n*** End Patch"

    // when
    await memoryApplyPatch(repo, {
      ...params(locksDirectory, "remember patch provenance", input),
      provenance: { sessionId: "session-patch", userTurns: 9 },
    })

    // then
    expect((await repo.log({ limit: 1 }))[0]?.trailers).toEqual({
      "Omo-Writer": "memory-tool",
      "Omo-Session": "session-patch",
      "Omo-Turn": "9",
    })
  }, { timeout: MEMORY_GIT_TEST_TIMEOUT_MS })

  it("#given a delete and configured remote #when applied #then writer lock, deletion, and remote result shape are pinned", async () => {
    // #given
    const { root, dir, repo } = await fixture({
      "system/delete.md": "---\ndescription: Delete me\n---\nbody",
    })
    await git(dir, ["remote", "add", "origin", join(root, "remote.git")])
    const domains: string[] = []
    const input = "*** Begin Patch\n*** Delete File: system/delete.md\n*** End Patch"

    // #when
    const result = await runMemoryApplyPatch({
      repo,
      params: { reason: "remove stale memory", input, author },
      lock: async (domain, operation) => {
        domains.push(domain)
        return operation()
      },
    })

    // #then
    expect(domains).toEqual(["memory-write"])
    expect(await repo.lsTree()).toEqual([])
    expect(result.message).toMatch(/^memory_apply_patch committed \([a-f0-9]{7}\); harness will sync after the turn\.$/)
  }, { timeout: MEMORY_GIT_TEST_TIMEOUT_MS })
})
