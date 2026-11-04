import { describe, expect, it } from "bun:test"
import { compileMemoryBlockWithReads } from "./compile"
import { memory, repoWith } from "./compile.test-support"
import * as realRenderer from "./external-projection"
import { createExternalProjectionRendererLoader, EXTERNAL_PROJECTION_RENDERER_FIX } from "./external-projection-loader"

const STALE_MANIFEST = "Cannot find package '#memory-external-projection' imported from /plugin/extensions/omo.js"

function failingThenWorkingImport(failures: number) {
  let calls = 0
  return {
    importRenderer: async () => {
      calls += 1
      if (calls <= failures) throw new Error(STALE_MANIFEST)
      return realRenderer
    },
    calls: () => calls,
  }
}

describe("external projection renderer loader", () => {
  it("#given a renderer import that fails #when memory compiles #then the block is compiled without the listing and marked degraded", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("PERSONA_DESCRIPTION", "PERSONA_BODY\n") },
      { relativePath: "reference/details.md", content: memory("REFERENCE_DESCRIPTION", "EXTERNAL_BODY\n") },
    ])
    const warnings: string[] = []
    const loader = createExternalProjectionRendererLoader(failingThenWorkingImport(1).importRenderer, (message) => warnings.push(message))

    // when
    const compiled = await compileMemoryBlockWithReads(repo, await repo.head(), { agentId: "agent-stale" }, Date.now(), loader)

    // then
    expect(compiled.block).toContain("PERSONA_BODY")
    expect(compiled.block).not.toContain("<external_projection>")
    expect(compiled.degraded).toEqual([expect.stringContaining(STALE_MANIFEST)])
    expect(compiled.degraded[0]).toContain(EXTERNAL_PROJECTION_RENDERER_FIX)
    expect(warnings).toHaveLength(1)
  }, 30_000)

  it("#given a renderer import that keeps failing #when it is asked three times #then each call retries and the fix is warned once", async () => {
    // given
    const attempts = failingThenWorkingImport(3)
    const warnings: string[] = []
    const load = createExternalProjectionRendererLoader(attempts.importRenderer, (message) => warnings.push(message))

    // when
    const results = [await load(), await load(), await load()]

    // then
    expect(results.every((result) => "unavailable" in result)).toBe(true)
    expect(attempts.calls()).toBe(3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(EXTERNAL_PROJECTION_RENDERER_FIX)
  })

  it("#given a renderer import that failed once #when the next load succeeds #then the real renderer is returned", async () => {
    // given
    const load = createExternalProjectionRendererLoader(failingThenWorkingImport(1).importRenderer, () => undefined)

    // when
    const first = await load()
    const second = await load()

    // then
    expect("unavailable" in first).toBe(true)
    expect(second).toEqual({ renderer: realRenderer })
  })
})
