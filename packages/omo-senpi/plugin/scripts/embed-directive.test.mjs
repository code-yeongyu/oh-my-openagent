import { describe, expect, it } from "bun:test"

import {
  SENPI_GPT_ULTRAWORK_DIRECTIVE,
  SENPI_ULTRAWORK_DIRECTIVE,
} from "../../src/components/ultrawork/generated-directive.ts"
import { readDirectives, transformDirective } from "./embed-directive.mjs"

const block = (body) => `<ultrawork-mode>\n${body}\n</ultrawork-mode>\n`

describe("embed-directive variants", () => {
  it("#given a source with frontmatter and trailing blank lines #when transformed #then only the mode block remains, ending in one newline", () => {
    expect(transformDirective("default", `---\nname: ultrawork\n---\n\n${block("A")}\n\n`)).toBe(block("A"))
  })

  it("#given a source that is not exactly one mode block #when transformed #then the build fails naming the variant", () => {
    for (const source of ["A\n", `${block("A")}${block("B")}`, `intro\n${block("A")}`, `${block("A")}trailing\n`]) {
      expect(() => transformDirective("gpt", source)).toThrow(
        /gpt directive source must be exactly one <ultrawork-mode> block/,
      )
    }
  })

  it("#given a source naming another harness's tool #when transformed #then the build fails naming the variant", () => {
    expect(() => transformDirective("gpt", block("call spawn_agent now"))).toThrow(
      /gpt directive source contains forbidden non-senpi tokens/,
    )
  })

  it("#given the generated module #when loaded #then each export equals its variant's derivation from the shipped source", () => {
    const directives = readDirectives()
    expect(Object.keys(directives)).toEqual(["default", "gpt"])
    expect(SENPI_ULTRAWORK_DIRECTIVE).toBe(directives.default)
    expect(SENPI_GPT_ULTRAWORK_DIRECTIVE).toBe(directives.gpt)
  })
})
