import { describe, expect, test } from "bun:test"

import { resolveMemoryModelRegistry } from "./model-registry-resolver"

describe("resolveMemoryModelRegistry", () => {
  test("#given a Senpi model registry #when resolved from event context #then the typed port is returned", () => {
    const registry = {
      getAvailable: () => [],
      find: () => undefined,
    }

    expect(resolveMemoryModelRegistry({ modelRegistry: registry })).toBe(registry)
  })

  test("#given an incomplete registry #when resolved #then the unsafe boundary is rejected", () => {
    expect(resolveMemoryModelRegistry({ modelRegistry: { getAvailable: () => [] } })).toBeUndefined()
  })
})
