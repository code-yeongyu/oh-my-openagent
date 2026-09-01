import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "bun:test"
import { loadDreamPersona, loadReflectionPersona } from "./assets"

describe("dream persona asset", () => {
  it("#given the source asset and the packaged plugin copy #when loaded and read #then all copies are identical", () => {
    // given
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, "dream-persona.md"), "utf8")

    // when
    const loaded = loadDreamPersona().markdown
    const packaged = readFileSync(
      join(here, "..", "..", "..", "..", "omo-senpi", "plugin", "extensions", "dream-persona.md"),
      "utf8",
    )

    // then
    expect(loaded).toBe(source)
    expect(packaged).toBe(source)
  })

  it("#given the dream persona #when parsed as sections #then the machine budget-contract anchor is embedded", () => {
    const { sections } = loadDreamPersona()

    expect(sections.some((section) => section.heading === "System Token Budget Contract")).toBe(true)
  })

  it("#given the dream persona #when parsed as sections #then the memory-usage ledger input is documented", () => {
    const { markdown } = loadDreamPersona()

    expect(markdown).toContain("$MEMORY_USAGE_PATH")
  })
})

describe("reflection persona asset", () => {
  it("#given the source asset #when loaded through assets.ts #then it equals the real source", () => {
    // given
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, "reflection-persona.md"), "utf8")

    // when
    const loaded = loadReflectionPersona().markdown

    // then
    expect(loaded).toBe(source)
  })

  it("#given the reflection persona asset #when trailer keys are parsed #then the runtime keys are present", () => {
    // given
    const { markdown } = loadReflectionPersona()

    // when
    const trailerKeys = markdown
      .split("\n")
      .map((line) => line.slice(0, line.indexOf(":")))
      .filter((key) => key === "Generated-By" || key === "Agent-ID")

    // then
    expect(trailerKeys).toEqual(["Generated-By", "Agent-ID"])
  })
})
