import { describe, expect, it, onTestFinished, spyOn } from "bun:test"
import { MemoryBlockCache } from "./cache"
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
  it("#given a renderer import that fails once #when the cache compiles one revision twice #then the degraded block is not kept and the next compile renders the listing", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("PERSONA_DESCRIPTION", "PERSONA_BODY\n") },
      { relativePath: "reference/details.md", content: memory("REFERENCE_DESCRIPTION", "EXTERNAL_BODY\n") },
    ])
    const warnings: string[] = []
    const degraded: (readonly string[])[] = []
    const cache = new MemoryBlockCache({
      loadExternalProjectionRenderer: createExternalProjectionRendererLoader(failingThenWorkingImport(1).importRenderer, (message) => warnings.push(message)),
      onDegraded: ({ reasons }) => degraded.push(reasons),
    })
    const head = await repo.head()
    const at = Date.now()

    // when
    const first = await cache.compile(repo, "prompt {CORE_MEMORY}", { agentId: "agent-stale" }, head, at)
    const next = await cache.compile(repo, "prompt {CORE_MEMORY}", { agentId: "agent-stale" }, head, at)

    // then
    expect(first).toContain("PERSONA_BODY")
    expect(first).not.toContain("<external_projection>")
    expect(next).toContain("<external_projection>")
    expect(next).toContain("details")
    expect(degraded).toEqual([[expect.stringContaining(STALE_MANIFEST)]])
    expect(degraded[0]?.[0]).toContain(EXTERNAL_PROJECTION_RENDERER_FIX)
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

  it("#given two bundle copies of the loader with the default warning #when both fail #then the process is warned once", async () => {
    // given
    const warned = Symbol.for("omo.memory.external-projection-renderer-warned")
    Reflect.deleteProperty(globalThis, warned)
    const emitWarning = spyOn(process, "emitWarning").mockImplementation(() => undefined)
    onTestFinished(() => {
      emitWarning.mockRestore()
      Reflect.deleteProperty(globalThis, warned)
    })
    const bundles = [
      createExternalProjectionRendererLoader(failingThenWorkingImport(1).importRenderer),
      createExternalProjectionRendererLoader(failingThenWorkingImport(1).importRenderer),
    ]

    // when
    for (const load of bundles) await load()

    // then
    expect(emitWarning).toHaveBeenCalledTimes(1)
    expect(emitWarning.mock.calls[0]?.[1]).toEqual({ code: "OMO_MEMORY_PROJECTION_RENDERER_UNAVAILABLE" })
  })
})
