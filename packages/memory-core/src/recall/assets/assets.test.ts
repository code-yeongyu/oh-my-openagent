import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadKibitzerPersona } from "./assets"

describe("kibitzer persona asset", () => {
  it("#given the source asset #when loaded through assets.ts #then it equals the real file and is non-empty", () => {
    // given
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, "kibitzer-persona.md"), "utf8")

    // when
    const loaded = loadKibitzerPersona()

    // then
    expect(loaded).toBe(source)
    expect(loaded.trim().length).toBeGreaterThan(0)
  })
})
