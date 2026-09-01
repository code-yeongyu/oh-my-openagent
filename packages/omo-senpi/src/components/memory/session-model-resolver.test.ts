import { describe, expect, test } from "bun:test"

import { resolveMemorySessionModel } from "./session-model-resolver"

describe("resolveMemorySessionModel", () => {
  describe("#given a senpi event context carrying the active model", () => {
    test("#when resolved #then it yields the provider and id", () => {
      // given: the same context object that already carries modelRegistry also carries model
      const eventCtx = {
        modelRegistry: { getAvailable: () => [], find: () => undefined },
        model: { provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 200_000 },
      }

      // when / then
      expect(resolveMemorySessionModel(eventCtx)).toEqual({ provider: "anthropic", id: "claude-opus-5" })
    })
  })

  describe("#given a context that cannot supply a model", () => {
    test("#when the model is absent, malformed, or the context is not a record #then it resolves to undefined", () => {
      // when / then
      expect(resolveMemorySessionModel(undefined)).toBeUndefined()
      expect(resolveMemorySessionModel(null)).toBeUndefined()
      expect(resolveMemorySessionModel("nope")).toBeUndefined()
      expect(resolveMemorySessionModel([])).toBeUndefined()
      expect(resolveMemorySessionModel({})).toBeUndefined()
      expect(resolveMemorySessionModel({ model: undefined })).toBeUndefined()
      expect(resolveMemorySessionModel({ model: { provider: "anthropic" } })).toBeUndefined()
      expect(resolveMemorySessionModel({ model: { id: "claude-opus-5" } })).toBeUndefined()
      expect(resolveMemorySessionModel({ model: { provider: "", id: "x" } })).toBeUndefined()
      expect(resolveMemorySessionModel({ model: { provider: "x", id: "" } })).toBeUndefined()
      expect(resolveMemorySessionModel({ model: { provider: 1, id: 2 } })).toBeUndefined()
    })
  })
})
