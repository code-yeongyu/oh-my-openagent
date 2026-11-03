import { describe, expect, it } from "bun:test"

import type { RecallTermStoreModule } from "@oh-my-opencode/memory-core"
import { createRecallStoreRuntimeLoader, RECALL_STORE_RUNTIME_ARTIFACT } from "./recall-store-runtime-loader"

const runtime = { RecallTermPersistence: class {} } as unknown as RecallTermStoreModule

describe("recall store runtime loader", () => {
  it("#given a sidecar import that fails once #when the next corpus load asks again #then it retries and then shares the loaded module", async () => {
    // given
    let imports = 0
    const load = createRecallStoreRuntimeLoader(async () => {
      imports += 1
      if (imports === 1) throw new Error("Cannot find module '#omo-recall-store-runtime'")
      return runtime
    })

    // when
    const failure = await load().catch((error: unknown) => error)
    const first = await load()
    const second = await load()

    // then
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain(RECALL_STORE_RUNTIME_ARTIFACT)
    expect(first).toBe(runtime)
    expect(second).toBe(runtime)
    expect(imports).toBe(2)
  })
})
