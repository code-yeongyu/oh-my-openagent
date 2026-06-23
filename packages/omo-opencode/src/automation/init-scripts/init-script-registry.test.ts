import { describe, it, expect } from "bun:test"
import { createInitScriptRegistry, InitScriptValidationError } from "./init-script-registry"

describe("createInitScriptRegistry", () => {
  describe("#given an empty registry", () => {
    it("#when register valid script #then list returns it", () => {
      const r = createInitScriptRegistry()
      r.register({ name: "foo", source: "var x = 1;" })
      expect(r.list()).toHaveLength(1)
      expect(r.list()[0]?.name).toBe("foo")
    })

    it("#when has(name) before register #then false", () => {
      const r = createInitScriptRegistry()
      expect(r.has("foo")).toBe(false)
    })

    it("#when register missing name #then throws", () => {
      const r = createInitScriptRegistry()
      expect(() => r.register({ name: "", source: "var x = 1;" })).toThrow(InitScriptValidationError)
    })

    it("#when register missing source #then throws", () => {
      const r = createInitScriptRegistry()
      expect(() => r.register({ name: "foo", source: "" })).toThrow(InitScriptValidationError)
    })
  })

  describe("#given a registry with one script", () => {
    it("#when register same name #then overwrites", () => {
      const r = createInitScriptRegistry()
      r.register({ name: "foo", source: "var a = 1;" })
      r.register({ name: "foo", source: "var b = 2;" })
      expect(r.list()).toHaveLength(1)
      expect(r.list()[0]?.source).toBe("var b = 2;")
    })

    it("#when has(name) after register #then true", () => {
      const r = createInitScriptRegistry()
      r.register({ name: "foo", source: "var x = 1;" })
      expect(r.has("foo")).toBe(true)
    })

    it("#when clear #then list empty", () => {
      const r = createInitScriptRegistry()
      r.register({ name: "foo", source: "var x = 1;" })
      r.clear()
      expect(r.list()).toHaveLength(0)
      expect(r.has("foo")).toBe(false)
    })
  })

  describe("#given a registry with multiple scripts", () => {
    it("#when list #then preserves insertion order", () => {
      const r = createInitScriptRegistry()
      r.register({ name: "a", source: "var a = 1;" })
      r.register({ name: "b", source: "var b = 1;" })
      r.register({ name: "c", source: "var c = 1;" })
      expect(r.list().map(s => s.name)).toEqual(["a", "b", "c"])
    })
  })
})
