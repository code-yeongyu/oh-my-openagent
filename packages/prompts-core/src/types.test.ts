import { describe, expect, test } from "bun:test"
import type { LoadPromptInput, LoadedPrompt, PromptSource, RuntimeInjection } from "./types"

describe("prompt core types", () => {
  test("#given loader input shape #then accepts source name variant and runtime injections", () => {
    const source: PromptSource = { baseDir: "/tmp/prompts" }
    const injection: RuntimeInjection = { placeholder: "{X}", resolver: () => "Y" }

    const input = {
      source,
      name: "test",
      variant: "default",
      inject: [injection],
    } satisfies LoadPromptInput

    expect(input.source.baseDir).toBe("/tmp/prompts")
    expect(input.inject[0]?.placeholder).toBe("{X}")
  })

  test("#given loaded prompt shape #then carries frontmatter and rendered body", () => {
    const loaded = {
      frontmatter: { title: "Fixture" },
      body: "Prompt body",
      hadFrontmatter: true,
      parseError: false,
      filePath: "/tmp/prompts/test/default.md",
    } satisfies LoadedPrompt<{ readonly title: string }>

    expect(loaded.frontmatter.title).toBe("Fixture")
    expect(loaded.body).toBe("Prompt body")
  })
})
