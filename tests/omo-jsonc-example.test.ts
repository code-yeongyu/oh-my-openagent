import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { OmoConfigSchema } from "../packages/omo-config-core/src/schema"
import { parse as parseJsonc } from "jsonc-parser"

const REPO_ROOT = join(import.meta.dir, "..")
const EXAMPLE_PATH = join(REPO_ROOT, "assets", "omo.jsonc.example")

function readExampleText(): string {
  return readFileSync(EXAMPLE_PATH, "utf-8")
}

/** Uncommented security keys, so the shipped example cannot predate the schema that accepts it. */
function commentedKeys(text: string): string[] {
  return Array.from(text.matchAll(/^\s*\/\/\s*"([a-z0-9_]+)"\s*:/gmu), (match) => match[1])
}

describe("assets/omo.jsonc.example", () => {
  test("#given the shipped example #when parsed as JSONC #then it has no parse error", () => {
    // given
    const text = readExampleText()

    // when
    const errors: Array<{ error: number; offset: number; length: number }> = []
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true })

    // then
    expect(errors).toEqual([])
    expect(typeof parsed).toBe("object")
  })

  test("#given the shipped example #when validated by OmoConfigSchema #then it is accepted", () => {
    // given
    const text = readExampleText()

    // when
    const parsed = parseJsonc(text, [], { allowTrailingComma: true })
    const result = OmoConfigSchema.safeParse(parsed)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
  })

  test("#given the shipped example #when its $schema is read #then it points at the documented dev-branch schema URL", () => {
    // given
    const text = readExampleText()

    // when
    const parsed = parseJsonc(text, [], { allowTrailingComma: true }) as { readonly $schema?: string }

    // then
    expect(parsed.$schema).toBe(
      "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
    )
  })

  test("#given a schema that rejects unknown top-level keys #when the example is validated #then no security key is left uncommented", () => {
    // given
    const text = readExampleText()

    // when
    const parsed = parseJsonc(text, [], { allowTrailingComma: true }) as Record<string, unknown>

    // then
    // A `security` block left uncommented would fail the strict schema on every build before the
    // key lands, so every key the example documents stays commented until its own PR merges.
    expect(Object.keys(parsed).filter((key) => key === "security")).toEqual([])
    expect(commentedKeys(text)).toContain("file_ref_allowlist_roots")
    expect(commentedKeys(text)).toContain("auth_at_rest")
  })
})