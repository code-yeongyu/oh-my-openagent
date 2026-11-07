import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RUNTIME_CAPABILITIES_FILE, runtimeCapabilitiesText, runtimeDeclaresKeychainHandoff } from "./runtime-capabilities"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("runtime capability file (RULING-74)", () => {
  test("#given the release build #when it writes the capability file #then the name and bytes are the cross-repo contract", () => {
    // desktop#5057 copies exactly this file, by this name, beside the runtime.
    expect(RUNTIME_CAPABILITIES_FILE).toBe("omo-runtime-capabilities.json")
    expect(runtimeCapabilitiesText()).toBe('{"keychainHandoff":1}\n')
  })

  test("#given the file the build writes #when a CLI reads it beside the runtime #then the runtime declares the hand-off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-capabilities-"))
    roots.push(dir)
    writeFileSync(join(dir, "omo-runtime-capabilities.json"), runtimeCapabilitiesText())
    expect(await runtimeDeclaresKeychainHandoff(join(dir, "omo"))).toBe(true)
    expect(await runtimeDeclaresKeychainHandoff(join(dir, "elsewhere", "omo"))).toBe(false)
  })
})
