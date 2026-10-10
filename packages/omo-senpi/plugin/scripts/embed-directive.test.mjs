import { describe, expect, it } from "bun:test"

import { parseVariantBlocks, parseVariantSections, transformDirective } from "./embed-directive.mjs"

const skill = (body) => `---\nname: ultrawork\n---\n\n${body}`

describe("embed-directive astra variant", () => {
  it("#given marker-free input #when the baseline is derived #then the marker lines vanish and the text stays", () => {
    const body = "<ultrawork-mode>\nA\n<!-- omo-ultrawork-astra:one:start -->\nB\n<!-- omo-ultrawork-astra:one:end -->\nC\n</ultrawork-mode>\n"
    expect(transformDirective(skill(body))).toBe("<ultrawork-mode>\nA\nB\nC\n</ultrawork-mode>\n")
  })

  it("#given a section per block #when the Astra variant is derived #then each block is replaced and an empty section cuts the block", () => {
    const body = "<ultrawork-mode>\nA\n<!-- omo-ultrawork-astra:one:start -->\nB\n<!-- omo-ultrawork-astra:one:end -->\nC\n<!-- omo-ultrawork-astra:two:start -->\nD\n<!-- omo-ultrawork-astra:two:end -->\nE\n</ultrawork-mode>\n"
    const variant = "## one\nB2\n\n## two\n"
    expect(transformDirective(skill(body), variant)).toBe("<ultrawork-mode>\nA\nB2\nC\nE\n</ultrawork-mode>\n")
  })

  it("#given a section without a block or a block without a section #when the Astra variant is derived #then the build fails naming both", () => {
    const body = "<ultrawork-mode>\n<!-- omo-ultrawork-astra:one:start -->\nB\n<!-- omo-ultrawork-astra:one:end -->\n</ultrawork-mode>\n"
    expect(() => transformDirective(skill(body), "## two\nX\n")).toThrow(/missing sections: one; sections without a block: two/)
  })

  it("#given nested, duplicate, or unclosed markers #when parsed #then each is rejected", () => {
    expect(() => parseVariantBlocks("<!-- omo-ultrawork-astra:a:start -->\n<!-- omo-ultrawork-astra:b:start -->\n")).toThrow(/opens inside/)
    expect(() => parseVariantBlocks("<!-- omo-ultrawork-astra:a:start -->\nx\n<!-- omo-ultrawork-astra:a:end -->\n<!-- omo-ultrawork-astra:a:start -->\ny\n<!-- omo-ultrawork-astra:a:end -->\n")).toThrow(/appears twice/)
    expect(() => parseVariantBlocks("<!-- omo-ultrawork-astra:a:start -->\nx\n")).toThrow(/never closes/)
    expect(() => parseVariantBlocks("<!-- omo-ultrawork-astra:a:end -->\n")).toThrow(/closes nothing/)
    expect(() => parseVariantSections("intro\n## a\nx\n")).toThrow(/text before/)
    expect(() => parseVariantSections("## a\nx\n## a\ny\n")).toThrow(/defines "a" twice/)
  })

  it("#given the shipped SKILL.md and astra-variant.md #when both directives are derived #then the baseline equals the marker-stripped skill body", () => {
    const { readFileSync } = require("node:fs")
    const { resolve } = require("node:path")
    const root = resolve(import.meta.dir, "../..")
    const source = readFileSync(resolve(root, "skills/ultrawork/SKILL.md"), "utf8")
    const variant = readFileSync(resolve(root, "skills/ultrawork/references/astra-variant.md"), "utf8")
    const stripped = source.replace(/^---\n[\s\S]*?\n---\n+/, "").replace(/^<!-- omo-ultrawork-astra:[a-z0-9-]+:(?:start|end) -->\n/gm, "")
    expect(transformDirective(source)).toBe(`${stripped.trim()}\n`)
    expect(transformDirective(source, variant)).not.toBe(transformDirective(source))
  })
})
