import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { engineSupportsReferenceObjects, readEngineCapabilities, shouldEmitReferenceObjects } from "../bin/lib/engine-capabilities.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

/** An engine package root whose manifest says what the caller needs it to say. */
function engineRoot(manifest: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "omo-engine-"))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "package.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest))
  return root
}

describe("the reference-object capability gate", () => {
  describe("#given an engine that declares no capabilities", () => {
    describe("#when the gate is read", () => {
      test("#then it is closed, and a missing field means the engine does not support the shapes", () => {
        expect(engineSupportsReferenceObjects({ capabilities: undefined })).toBe(false)
        expect(engineSupportsReferenceObjects({ capabilities: {} })).toBe(false)
        expect(engineSupportsReferenceObjects({ capabilities: { configReferenceObjects: 0 } })).toBe(false)
      })
    })
  })

  describe("#given an engine whose capability is below one", () => {
    describe("#when the gate is read", () => {
      test("#then it is closed", () => {
        expect(engineSupportsReferenceObjects({ capabilities: { configReferenceObjects: 0 } })).toBe(false)
      })
    })
  })

  describe("#given an engine that declares the capability", () => {
    describe("#when the gate is read", () => {
      test("#then it is open", () => {
        expect(engineSupportsReferenceObjects({ capabilities: { configReferenceObjects: 1 } })).toBe(true)
      })

      test("#then a higher number is open too, because a higher number only ever adds", () => {
        expect(engineSupportsReferenceObjects({ capabilities: { configReferenceObjects: 2 } })).toBe(true)
      })
    })
  })

  describe("#given the caller overrides the gate", () => {
    describe("#when the gate is read", () => {
      test("#then the override wins over what the engine declares", () => {
        const root = engineRoot({ name: "@code-yeongyu/senpi", senpiCapabilities: { configReferenceObjects: 1 } })
        expect(shouldEmitReferenceObjects({ referenceObjects: true, senpiPackageRoot: root })).toBe(true)
        expect(shouldEmitReferenceObjects({ referenceObjects: false, senpiPackageRoot: root })).toBe(false)
      })
    })
  })

  describe("#given the environment forces the shape", () => {
    describe("#when the gate is read", () => {
      test("#then it is open whatever the engine declares", () => {
        const root = engineRoot({ name: "@code-yeongyu/senpi" })
        expect(shouldEmitReferenceObjects({ env: { OMO_REFERENCE_OBJECTS: "1" }, senpiPackageRoot: root })).toBe(true)
        expect(shouldEmitReferenceObjects({ env: {}, senpiPackageRoot: root })).toBe(false)
      })
    })
  })
})

describe("reading the capability off the engine manifest", () => {
  describe("#given an engine that declares the capability", () => {
    describe("#when its manifest is read", () => {
      test("#then the gate opens", () => {
        const root = engineRoot({ name: "@code-yeongyu/senpi", senpiCapabilities: { configReferenceObjects: 1 } })

        expect(readEngineCapabilities({ senpiPackageRoot: root })).toEqual({ configReferenceObjects: 1 })
        expect(engineSupportsReferenceObjects({ senpiPackageRoot: root })).toBe(true)
      })
    })
  })

  describe("#given an engine whose manifest has no capability", () => {
    describe("#when its manifest is read", () => {
      test("#then the gate is closed", () => {
        const root = engineRoot({ name: "@code-yeongyu/senpi", version: "2026.10.21-2" })

        expect(readEngineCapabilities({ senpiPackageRoot: root })).toBeUndefined()
        expect(engineSupportsReferenceObjects({ senpiPackageRoot: root })).toBe(false)
      })
    })
  })

  describe("#given an engine whose manifest cannot be read", () => {
    describe("#when its manifest is read", () => {
      test("#then the gate is closed, because a check that could not look is not a check that passed", () => {
        const root = engineRoot("{ not json")

        expect(readEngineCapabilities({ senpiPackageRoot: root })).toBeUndefined()
        expect(engineSupportsReferenceObjects({ senpiPackageRoot: root })).toBe(false)
      })
    })
  })

  describe("#given an engine that cannot be found", () => {
    describe("#when its capability is read", () => {
      test("#then the gate is closed", () => {
        expect(engineSupportsReferenceObjects({ senpiPackageRoot: "/nonexistent/engine/root" })).toBe(false)
      })
    })
  })

  describe("#given the environment turns the shape off", () => {
    describe("#when the gate is read", () => {
      test("#then it is closed even for an engine that declares the capability", () => {
        const root = engineRoot({ name: "@code-yeongyu/senpi", senpiCapabilities: { configReferenceObjects: 1 } })

        expect(shouldEmitReferenceObjects({ env: { OMO_REFERENCE_OBJECTS: "0" }, senpiPackageRoot: root })).toBe(false)
      })
    })
  })
})
