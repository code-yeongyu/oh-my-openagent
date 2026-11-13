import { describe, expect, test } from "bun:test"

import { createTaskRuntimeLoader } from "./task-runtime"

describe("createTaskRuntimeLoader", () => {
  test("#given a resolving import #when the loader is called twice #then the module is imported once and both calls share it", async () => {
    // given
    let imports = 0
    const runtime = { createInProcessJudgeRunner: () => undefined }
    const load = createTaskRuntimeLoader(async () => {
      imports += 1
      return runtime
    })

    // when
    const [first, second] = await Promise.all([load(), load()])

    // then
    expect(imports).toBe(1)
    expect(first).toBe(runtime)
    expect(second).toBe(runtime)
  })

  test("#given a rejecting import #when the loader is called again #then the failure is not cached and the import is retried", async () => {
    // given: mirrors memory-core's persona cache - a failed read is never kept, so a repaired tree recovers
    let imports = 0
    const load = createTaskRuntimeLoader(async () => {
      imports += 1
      if (imports === 1) throw new Error("Cannot find module './extensions/omo-task.js'")
      return { createInProcessJudgeRunner: () => undefined }
    })

    // when
    await expect(load()).rejects.toThrow("Cannot find module")
    const recovered = await load()

    // then
    expect(imports).toBe(2)
    expect(recovered).toBeDefined()
  })
})
