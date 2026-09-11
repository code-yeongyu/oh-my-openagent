import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveAndPreflightMemoryLaunch } from "./memory-launch-preflight"
import { resetModelPreflightCacheForTests } from "./model-preflight"
import { reflectionRemediation } from "./remediation"
import { MemoryModelExhaustedError, type MemoryModelChain } from "./memory-model-attempts"
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
// rejects slashed ids reaches the "catalog omits every candidate" warning instead of the empty-catalog
// probe error. Both degrade to a reactive launch, so the slash tests below also assert that no preflight
// warning fired - only the `filtered` verdict is silent - to keep the assertion from passing for the
// wrong reason.
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
        const warnings: string[] = []

        // when
        await resolveAndPreflightMemoryLaunch({
          candidates: [{ model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" }] as unknown as MemoryModelChain,
          senpiCommand: item.command,
          senpiPrefixArgs: item.prefixArgs,
          env: { PATH: process.env.PATH },
          envFlag: surface === "reflection" ? "SENPI_MEMORY_REFLECTION" : "SENPI_MEMORY_FACTS",
          configSources: [{ path: item.config, exists: true }],
          warn: (message) => warnings.push(message),
          surfaceName: surface,
          attempt: async (candidate) => {
            launched.push(candidate.model)
            return SUCCESSFUL_CHILD
          },
        })

        // then
        expect(launched).toEqual(["apitopia/z-ai/glm-5.2-ultrafast-unlocked"])
        expect(warnings).toEqual([])
      })
    }
  })

  describe("#given a freshly probed catalog that omits the only candidate", () => {
    // `--list-models` in the discovery-disabled child intermittently omits whole providers (#7923), so
    // a parseable-but-incomplete catalog must not fail the run closed before any child is spawned. The
    // reactive `model_not_visible` classifier makes the final call after a real spawn.
    test("#when the reflection surface launches #then the candidate still reaches the child instead of failing closed", async () => {
      // given
      const item = await catalog(TABLE_WITHOUT_THE_MODEL)
      const launched: string[] = []

      // when
      await resolveAndPreflightMemoryLaunch({
        candidates: [{ model: "openai-codex/gpt-5.6-luna-fast" }] as unknown as MemoryModelChain,
        senpiCommand: item.command,
        senpiPrefixArgs: item.prefixArgs,
        env: { PATH: process.env.PATH },
        envFlag: "SENPI_MEMORY_REFLECTION",
        configSources: [{ path: item.config, exists: true }],
        surfaceName: "reflection",
        attempt: async (candidate) => {
          launched.push(candidate.model)
          return SUCCESSFUL_CHILD
        },
      })

      // then
      expect(launched).toEqual(["openai-codex/gpt-5.6-luna-fast"])
    })
  })

  describe("#given a model the child genuinely cannot see", () => {
    // The diagnosis has to name the config, not the child log. The spawned child's own senpi error
    // text is classified into `model_not_visible` and the chain is reported exhausted, so the
    // remediation still points at memory.reflection instead of child-stderr.log.
    test("#when the only candidate is launched #then the exhausted chain is rejected with a remediation that names the config", async () => {
      // given
      const item = await catalog(TABLE_WITHOUT_THE_MODEL)
      let attempts = 0

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
          attempts += 1
          return {
            code: 1,
            signal: null,
            stdout: "",
            stderr: 'Error: Model "apitopia/truly-absent-model" not found. Use --list-models to see available models.',
            timedOut: false,
          }
        },
      })

      // then
      const error = await launch.then(() => undefined, (reason: unknown) => reason)
      expect(error).toBeInstanceOf(MemoryModelExhaustedError)
      const message = error instanceof Error ? error.message : ""
      expect(message).toContain("model_not_visible:apitopia/truly-absent-model")
      expect(attempts).toBe(1)
      const hint = reflectionRemediation("failed", message)
      expect(hint).toContain("memory.reflection")
      expect(hint).not.toContain("child-stderr.log")
    })
  })
})
