import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveAndPreflightMemoryLaunch } from "./memory-launch-preflight"
import { resetModelPreflightCacheForTests } from "./model-preflight"
import { reflectionRemediation } from "./remediation"
import type { MemoryModelChain } from "./memory-model-attempts"
import type { ReflectionChildResult } from "./spawn"

const SUCCESSFUL_CHILD: ReflectionChildResult = {
  code: 0,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
}

const roots: string[] = []
afterEach(async () => {
  resetModelPreflightCacheForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function catalog(table: string): Promise<{
  readonly command: string
  readonly prefixArgs: readonly string[]
  readonly config: string
}> {
  const root = await mkdtemp(join(tmpdir(), "memory-launch-preflight-"))
  roots.push(root)
  const launcher = join(root, "fake-senpi.mjs")
  const config = join(root, "omo.jsonc")
  await writeFile(launcher, `process.stdout.write(${JSON.stringify(table)})\n`, "utf8")
  await writeFile(config, "{}\n", "utf8")
  return { command: process.execPath, prefixArgs: [launcher], config }
}

// The second row keeps the parsed catalog non-empty when the slashed row is dropped, so a parser that
// rejects slashed ids reaches none_visible instead of the empty-catalog path that degrades to a
// reactive launch and would let this assertion pass for the wrong reason.
const TABLE_WITH_SLASH_ID = [
  "provider                    model                                                     context  max-out  thinking  images",
  "apitopia                    z-ai/glm-5.2-ultrafast-unlocked                           1M       131.1K   yes       no",
  "apitopia                    kimi-for-coding-highspeed                                 262.1K   65.5K    yes       yes",
].join("\n") + "\n"

const TABLE_WITHOUT_THE_MODEL = [
  "provider                    model                          context",
  "apitopia                    kimi-for-coding-highspeed      262.1K",
].join("\n") + "\n"

describe("resolveAndPreflightMemoryLaunch", () => {
  describe("#given a catalog whose model id contains a slash", () => {
    // Both memory surfaces funnel through this helper, so the slash-id catalog row has to survive
    // preflight for either of them or the child dies on senpi's own "Model ... not found".
    for (const surface of ["reflection", "facts"] as const) {
      test(`#when the ${surface} surface launches #then the slashed candidate reaches the child`, async () => {
        // given
        const item = await catalog(TABLE_WITH_SLASH_ID)
        const launched: string[] = []

        // when
        await resolveAndPreflightMemoryLaunch({
          candidates: [{ model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" }] as unknown as MemoryModelChain,
          senpiCommand: item.command,
          senpiPrefixArgs: item.prefixArgs,
          env: { PATH: process.env.PATH },
          envFlag: surface === "reflection" ? "SENPI_MEMORY_REFLECTION" : "SENPI_MEMORY_FACTS",
          configSources: [{ path: item.config, exists: true }],
          surfaceName: surface,
          attempt: async (candidate) => {
            launched.push(candidate.model)
            return SUCCESSFUL_CHILD
          },
        })

        // then
        expect(launched).toEqual(["apitopia/z-ai/glm-5.2-ultrafast-unlocked"])
      })
    }
  })

  describe("#given a model the child genuinely cannot see", () => {
    // The failure has to be diagnosed BEFORE a child runs. A spawned child would fail as child_exit
    // carrying senpi's own error text, which is what produced the unbounded repeating warning.
    test("#when the launch is preflighted #then it is rejected up front with a remediation that names the config", async () => {
      // given
      const item = await catalog(TABLE_WITHOUT_THE_MODEL)
      let childSpawned = false

      // when
      const launch = resolveAndPreflightMemoryLaunch({
        candidates: [{ model: "apitopia/truly-absent-model" }] as unknown as MemoryModelChain,
        senpiCommand: item.command,
        senpiPrefixArgs: item.prefixArgs,
        env: { PATH: process.env.PATH },
        envFlag: "SENPI_MEMORY_REFLECTION",
        configSources: [{ path: item.config, exists: true }],
        surfaceName: "reflection",
        attempt: async () => {
          childSpawned = true
          return SUCCESSFUL_CHILD
        },
      })

      // then
      const error = await launch.then(() => undefined, (reason: unknown) => reason)
      expect(error).toBeInstanceOf(Error)
      const message = error instanceof Error ? error.message : ""
      expect(message).toContain("apitopia/truly-absent-model")
      expect(childSpawned).toBe(false)
      const hint = reflectionRemediation("failed", message)
      expect(hint).toContain("memory.reflection")
      expect(hint).not.toContain("child-stderr.log")
    })
  })
})
