import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"

import { RETIRED_SECTION_DIGESTS } from "./layer-validation"
import { loadOmoConfig } from "./loader"

const roots: string[] = []
// Fixture keys for the retired sections; the first test pins them to the loader's digests.
const sections = [["d", "o", "r", "i"].join(""), ["gate", "way"].join("")]
const digest = (key: string): string => createHash("sha256").update(key.toLowerCase()).digest("hex")

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("ignored config sections", () => {
  test("the fixture keys are exactly the retired section digests", () => {
    expect(new Set(sections.map(digest))).toEqual(new Set(RETIRED_SECTION_DIGESTS))
  })

  for (const extension of ["json", "jsonc"]) {
    for (const [index, key] of sections.entries()) {
      test(`${extension} section ${index} is silently ignored in every config container`, () => {
        const homeDir = mkdtempSync(join(tmpdir(), "omo-ignored-sections-"))
        roots.push(homeDir)
        const cwd = join(homeDir, "project")
        mkdirSync(cwd)
        mkdirSync(join(homeDir, ".omo"))
        const path = join(homeDir, ".omo", `omo.${extension}`)
        const section = { [key]: { arbitrary: { enabled: true } } }
        const document = {
          ...section,
          disabled_skills: ["kept"],
          "[senpi]": { ...section, task: { default_concurrency: 3 } },
          profiles: {
            work: {
              ...section,
              telemetry: { enabled: false },
              "[senpi]": { ...section, categories: { quick: { model: "test/model" } } },
            },
          },
        }
        const content = `${extension === "jsonc" ? "// preserved comment\n" : ""}${JSON.stringify(document)}\n`
        writeFileSync(path, content)

        const result = loadOmoConfig({ cwd, env: { HOME: homeDir }, harness: "senpi", profile: "work" })

        expect(result.sources.filter((source) => source.loaded).map((source) => source.path)).toEqual([path])
        for (const sectionKey of sections) {
          expect(JSON.stringify(result.diagnostics)).not.toContain(sectionKey)
        }
        expect(result.config.disabled_skills).toEqual(["kept"])
        expect(result.config.task?.default_concurrency).toBe(3)
        expect(result.config.telemetry?.enabled).toBe(false)
        expect(result.config.categories?.quick?.model).toBe("test/model")
        expect(result.config).not.toHaveProperty(key)
        const layer = result.layers[0]?.config
        expect(layer).not.toHaveProperty(key)
        expect(layer?.["[native]"]).not.toHaveProperty(key)
        expect(layer?.profiles).toEqual({
          work: {
            telemetry: { enabled: false },
            "[native]": { categories: { quick: { model: "test/model" } } },
          },
        })
        expect(readFileSync(path, "utf-8")).toBe(content)
      })
    }
  }
})
