/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "skill", "SKILL.md")

type FrontMatter = Record<string, string>

function parseFrontMatter(markdown: string): FrontMatter {
  const lines = markdown.split(/\r?\n/)
  if (lines[0] !== "---") {
    throw new Error("SKILL.md must open with a YAML front matter fence")
  }
  const end = lines.indexOf("---", 1)
  if (end === -1) {
    throw new Error("SKILL.md front matter is not closed")
  }
  const fields: FrontMatter = {}
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(":")
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }
  return fields
}

describe("x-search skill front matter", () => {
  const frontMatter = parseFrontMatter(readFileSync(SKILL_PATH, "utf8"))

  it("#given the skill file #when parsing front matter #then name is pinned to x-search", () => {
    expect(frontMatter.name).toBe("x-search")
  })

  it("#given the skill file #when reading description #then it stays under 1024 chars", () => {
    expect(typeof frontMatter.description).toBe("string")
    expect(frontMatter.description.length).toBeGreaterThan(0)
    expect(frontMatter.description.length).toBeLessThan(1024)
  })

  it("#given the skill file #when reading description #then it is ASCII only", () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e]*$/.test(frontMatter.description)).toBe(true)
  })
})
