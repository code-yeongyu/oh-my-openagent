import { describe, expect, test } from "bun:test"

import { resolveMemoryModelRegistry } from "./model-registry-resolver"
import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"

describe("resolveMemoryModelRegistry", () => {
  test("#given a live ctx holding the concrete senpi registry #when resolved from event context #then that exact instance is returned", () => {
    // given
    const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))

    // when / then
    expect(resolveMemoryModelRegistry({ modelRegistry: registry })).toBe(registry)
  })

  test("#given a structurally registry-shaped object that is not the concrete class #when resolved #then the boundary rejects it", () => {
    // given: an in-process child needs the real ModelRegistry (auth storage, model runtime, dynamic
    // providers), so a lookalike port must not cross this boundary.
    const lookalike = {
      getAvailable: () => [],
      find: () => undefined,
    }

    // when / then
    expect(resolveMemoryModelRegistry({ modelRegistry: lookalike })).toBeUndefined()
  })

  test("#given an incomplete registry #when resolved #then the unsafe boundary is rejected", () => {
    expect(resolveMemoryModelRegistry({ modelRegistry: { getAvailable: () => [] } })).toBeUndefined()
  })
})
