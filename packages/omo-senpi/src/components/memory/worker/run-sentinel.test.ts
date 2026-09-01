import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeRunJsonAtomic } from "./run-artifacts"
import { waitForRunCompletion, waitForRunSentinel } from "./run-sentinel"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("run completion sentinel", () => {
  test("#given a missing watch directory #when the watcher cannot start #then the bounded fallback reaches timeout", async () => {
    // given
    const path = join(tmpdir(), "missing-run-sentinel", "outcome.json")

    // when
    const result = await waitForRunSentinel(path, 0, () => 0)

    // then
    expect(result).toBe("timeout")
  })

  test("#given a stale prior-attempt outcome #when the current attempt publishes #then only the matching attempt completes", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "run-completion-sentinel-"))
    roots.push(runDir)
    const outcomePath = join(runDir, "outcome.json")
    const launchPath = join(runDir, "launch.json")
    await writeRunJsonAtomic(outcomePath, { version: 1, runId: "run-1", attempt: 1 })

    // when
    const completion = waitForRunCompletion(
      outcomePath,
      launchPath,
      () => (JSON.parse(readFileSync(outcomePath, "utf8")) as { attempt?: number }).attempt === 2,
      Date.now() + 5_000,
      Date.now,
    )
    await writeRunJsonAtomic(outcomePath, { version: 1, runId: "run-1", attempt: 2 })

    // then
    expect(await completion).toBe("present")
  })
})
