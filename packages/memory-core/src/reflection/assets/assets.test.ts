import { describe, expect, it } from "bun:test"
import { loadReflectionPersona } from "./assets"

describe("reflection persona asset", () => {
  it("#given the persona asset #when sections are parsed #then exactly the five phase headings are present by name", () => {
    // given
    const { sections } = loadReflectionPersona()

    // when
    const phaseHeadings = sections.map((s) => s.heading).filter((h) => /^Phase \d+:/.test(h))

    // then
    expect(phaseHeadings).toEqual([
      "Phase 1: Investigate",
      "Phase 2: Extract",
      "Phase 3: Update",
      "Phase 4: Review",
      "Phase 5: Commit",
    ])
  })

  it("#given the persona asset #when op-menu tokens are located #then they appear in preference order ending with the unsure-none heuristic", () => {
    // given
    const { markdown } = loadReflectionPersona()

    // when
    const tokens = ["`update`:", "`extend`:", "`deprecate`:", "`split`:", "`create`:", "`none`:"]
    const positions = tokens.map((t) => markdown.indexOf(t))

    // then
    for (const pos of positions) expect(pos).toBeGreaterThan(-1)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!)
    }
    expect(markdown.indexOf("when unsure between `create` and `none`, choose `none`")).toBeGreaterThan(
      positions[positions.length - 1]!,
    )
  })

  it("#given the commit-contract section #when trailer keys are parsed #then they equal exactly Generated-By and Agent-ID", () => {
    // given
    const { sections } = loadReflectionPersona()
    const commitSection = sections.find((s) => s.heading === "Phase 5: Commit")
    expect(commitSection).toBeDefined()

    // when
    const trailerKeys = [...commitSection!.body.matchAll(/^([A-Z][A-Za-z-]+): .+$/gm)].map((m) => m[1]!)

    // then
    expect(trailerKeys).toEqual(["Generated-By", "Agent-ID"])
  })

  it("#given the documented example commit message #when matched against the reflection-commit regex #then it matches", () => {
    // given
    const { sections } = loadReflectionPersona()
    const commitSection = sections.find((s) => s.heading === "Phase 5: Commit")!

    // when
    const example = "fix(reflection): consolidate duplicate build notes"

    // then
    expect(commitSection.body).toContain(example)
    expect(example).toMatch(/^(feat|fix|chore)\(reflection\): /)
  })
})
