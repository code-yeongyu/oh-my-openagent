import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { loadPrompt } from "./loader"
import { PromptNotFoundError } from "./types"

const fixturesSource = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__")

describe("loadPrompt", () => {
  describe("#given a markdown prompt fixture", () => {
    test("#when loading an existing prompt #then returns body and frontmatter", async () => {
      // given
      const expectedPath = join(fixturesSource, "demo", "default.md")

      // when
      const actual = await loadPrompt({ source: fixturesSource, name: "demo", variant: "default" })

      // then
      console.info("S8 actual:", JSON.stringify(actual))
      expect(actual).toEqual({
        body: "Hello {PLACEHOLDER}, this is a test.\n",
        frontmatter: { description: "test fixture" },
        resolvedPath: expectedPath,
      })
    })

    test("#when loading a missing prompt #then throws path-aware error", async () => {
      // given
      const expectedPath = join(fixturesSource, "missing", "default.md")

      // when
      let actual = "no throw"
      let thrown: unknown
      try {
        await loadPrompt({ source: fixturesSource, name: "missing", variant: "default" })
      } catch (error) {
        thrown = error
        if (error instanceof Error) {
          actual = error.message
        } else {
          throw error
        }
      }

      // then
      console.info("S9 actual:", actual)
      expect(thrown).toBeInstanceOf(PromptNotFoundError)
      expect(actual).toContain(expectedPath)
    })

    test("#when runtime injection is provided #then replaces placeholder", async () => {
      // given
      const input = {
        source: fixturesSource,
        name: "demo",
        variant: "default",
        inject: [{ placeholder: "{PLACEHOLDER}", resolver: () => "Y" }],
      }

      // when
      const actual = await loadPrompt(input)

      // then
      console.info("S10 actual:", actual.body)
      expect(actual.body).toBe("Hello Y, this is a test.\n")
    })

    test("#when multiple injections are provided #then replaces all found values", async () => {
      // given
      const input = {
        source: fixturesSource,
        name: "demo",
        variant: "default",
        inject: [
          { placeholder: "{PLACEHOLDER}", resolver: () => "Y" },
          { placeholder: "l", resolver: () => "L" },
          { placeholder: "test", resolver: () => "demo" },
          { placeholder: "{MISSING}", resolver: () => "ignored" },
        ],
      }

      // when
      const actual = await loadPrompt(input)

      // then
      console.info("S11 actual:", actual.body)
      expect(actual.body).toBe("HeLLo Y, this is a demo.\n")
    })
  })
})
