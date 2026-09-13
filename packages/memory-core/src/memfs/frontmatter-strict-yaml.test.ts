import { describe, expect, it } from "bun:test"
import { parse as parseYaml } from "yaml"
import { FrontmatterError, parseMemoryFile, renderMemoryFile } from "./frontmatter"
import {
  MAX_DESCRIPTION_LENGTH,
  describeDescriptionViolation,
  describeFrontmatterGrammarViolation,
  describeFrontmatterViolation,
} from "./frontmatter-validation"

function frontmatterAsSkillLoaderSees(rendered: string): Record<string, unknown> {
  const end = rendered.indexOf("\n---", 4)
  return parseYaml(rendered.slice(4, end)) as Record<string, unknown>
}

describe("renderMemoryFile strict YAML output", () => {
  const hazards = [
    "Always run the full chain by default: verify the repo, then merge",
    "Trailing colon:",
    "Issue #1439 is a comment # not really",
    "[bracketed] start",
    "{braced} start",
    "true",
    "null",
    "1.0",
    "- dash start",
    '"already quoted"',
    "'single quoted'",
    "Tab\tinside and unicode \u2014 dash",
    "yes: it: nests",
  ]

  for (const description of hazards) {
    it(`#given description ${JSON.stringify(description)} #when rendered #then yaml.parse returns the identical string`, () => {
      // #when
      const rendered = renderMemoryFile({ description }, "body")

      // #then
      expect(frontmatterAsSkillLoaderSees(rendered).description).toBe(description)
      expect(parseMemoryFile(rendered).frontmatter.description).toBe(description)
    })
  }

  it("#given a YAML-safe description #when rendered #then it stays a plain scalar byte-identical to the legacy form", () => {
    expect(renderMemoryFile({ description: "A note about the project" }, "body")).toBe(
      "---\ndescription: A note about the project\n---\nbody",
    )
  })

  it("#given kind, aliases and extra keys #when rendered #then every value is YAML-safe and read_only stays verbatim", () => {
    // #when
    const rendered = renderMemoryFile(
      {
        description: "Person - X",
        read_only: "true",
        kind: "person: yes",
        aliases: ["A: B", "C"],
        extra: { name: "x", version: "0.2.0", deprecated: "true", note: "step: one" },
      },
      "",
    )

    // #then
    expect(rendered).toContain("\nread_only: true\n")
    expect(frontmatterAsSkillLoaderSees(rendered)).toEqual({
      description: "Person - X",
      read_only: true,
      kind: "person: yes",
      aliases: ["A: B", "C"],
      name: "x",
      version: "0.2.0",
      deprecated: true,
      note: "step: one",
    })
  })

  it("#given an extra key that is not a plain YAML key #when rendered #then it throws FrontmatterError", () => {
    expect(() => renderMemoryFile({ description: "ok", extra: { "bad key": "v" } }, "")).toThrow(FrontmatterError)
  })

  it("#given a legacy description over the loader limit #when a body edit re-renders it #then the renderer only guarantees grammar", () => {
    // #given
    const description = `legacy: ${"x".repeat(MAX_DESCRIPTION_LENGTH + 100)}`

    // #when
    const rendered = renderMemoryFile({ description }, "edited body")

    // #then
    expect(frontmatterAsSkillLoaderSees(rendered).description).toBe(description)
    expect(describeFrontmatterGrammarViolation(rendered)).toBeNull()
    expect(describeFrontmatterViolation(rendered)).toContain(`${MAX_DESCRIPTION_LENGTH}`)
  })
})

describe("parseMemoryFile quoted scalars and extra keys", () => {
  it("#given a double-quoted description #when parsed #then the quotes are decoded, not kept", () => {
    const parsed = parseMemoryFile('---\ndescription: "Run: a, b \\"c\\""\n---\nbody')

    expect(parsed.frontmatter.description).toBe('Run: a, b "c"')
  })

  it("#given a legacy unquoted description containing ': ' #when parsed #then the first-colon reader still returns the whole line", () => {
    const parsed = parseMemoryFile("---\ndescription: Run the chain by default: verify, merge\n---\nbody")

    expect(parsed.frontmatter.description).toBe("Run the chain by default: verify, merge")
  })

  it("#given a SKILL.md with name/version/deprecated #when parsed and re-rendered #then every key survives with its type", () => {
    // #given
    const content = "---\nname: deploy\ndescription: Use when deploying\nversion: 0.2.0\ndeprecated: true\n---\n# Deploy\n"

    // #when
    const parsed = parseMemoryFile(content)
    const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)

    // #then
    expect(parsed.frontmatter.extra).toEqual({ name: "deploy", version: "0.2.0", deprecated: "true" })
    expect(frontmatterAsSkillLoaderSees(rendered)).toEqual({
      description: "Use when deploying",
      name: "deploy",
      version: "0.2.0",
      deprecated: true,
    })
    expect(parseMemoryFile(rendered)).toEqual(parsed)
    expect(rendered.endsWith("---\n# Deploy\n")).toBe(true)
  })

  it("#given a legacy extra value with an unquoted ': ' #when re-rendered #then it is quoted and reads back verbatim", () => {
    const parsed = parseMemoryFile("---\ndescription: ok\nreplaced_by: see: other\n---\n")
    const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)

    expect(frontmatterAsSkillLoaderSees(rendered).replaced_by).toBe("see: other")
    expect(parseMemoryFile(rendered).frontmatter.extra).toEqual({ replaced_by: '"see: other"' })
  })

  it("#given the legacy limit key #when parsed #then it is still ignored rather than preserved", () => {
    const parsed = parseMemoryFile("---\ndescription: ok\nlimit: 5000\n---\n")

    expect(parsed.frontmatter.extra).toBeUndefined()
  })
})

describe("describeDescriptionViolation", () => {
  it("#given a one-line description at the limit #then it is accepted", () => {
    expect(describeDescriptionViolation("x".repeat(MAX_DESCRIPTION_LENGTH))).toBeNull()
  })

  it("#given a description over the skill loader limit #then the violation names the limit", () => {
    expect(describeDescriptionViolation("x".repeat(MAX_DESCRIPTION_LENGTH + 1))).toContain(`${MAX_DESCRIPTION_LENGTH}`)
  })

  it("#given tool-call scaffolding swallowed into the description #then the violation says the call was malformed", () => {
    const leaked = 'Real text</description> <parameter name="file_text"># Body that should have been file_text'

    const violation = describeDescriptionViolation(leaked)

    expect(violation).toContain("</description>")
    expect(violation).toMatch(/malformed|split/i)
  })

  it("#given a multi-line description #then it is rejected", () => {
    expect(describeDescriptionViolation("line one\nline two")).toContain("single line")
  })
})

describe("describeFrontmatterViolation", () => {
  it("#given renderer output for a hazardous description #then there is no violation", () => {
    expect(describeFrontmatterViolation(renderMemoryFile({ description: "a: b # c" }, "body"))).toBeNull()
  })

  it("#given an unquoted description with ': ' #then it is reported as an unsafe plain scalar", () => {
    const violation = describeFrontmatterViolation("---\ndescription: by default: verify\n---\nbody")

    expect(violation).toContain("'description' is not a safe YAML plain scalar")
    expect(() => parseYaml("description: by default: verify")).toThrow(/Nested mappings/)
  })

  it("#given a plain value that YAML would silently truncate at ' #' #then it is reported as unsafe", () => {
    const violation = describeFrontmatterViolation("---\ndescription: senpi #1439 tail\n---\nbody")

    expect(violation).toContain("'description'")
    expect(violation).toContain("plain scalar")
  })

  it("#given a description that YAML reads as a boolean #then it is rejected as an unsafe plain scalar", () => {
    expect(describeFrontmatterViolation("---\ndescription: true\n---\nbody")).toContain("plain scalar")
    expect(parseYaml("description: true").description).toBe(true)
  })

  it("#given a block scalar or an indented continuation #then the single-line contract names it", () => {
    expect(describeFrontmatterViolation("---\ndescription: >\n  folded\n---\nbody")).toContain("single line")
    expect(describeFrontmatterViolation("---\ndescription: ok\n  stray: 1\n---\nbody")).toContain("indented")
  })

  it("#given a duplicate key #then it is rejected like the yaml package rejects it", () => {
    expect(describeFrontmatterViolation("---\ndescription: a\ndescription: b\n---\nbody")).toContain("duplicate")
    expect(() => parseYaml("description: a\ndescription: b")).toThrow()
  })

  it("#given a SKILL.md-shaped file with extra keys #then only the description contract is checked", () => {
    expect(describeFrontmatterViolation("---\nname: deploy\ndescription: Use when deploying\nversion: 0.2.0\n---\nsteps\n")).toBeNull()
  })

  it("#given no description #then the violation names the field", () => {
    expect(describeFrontmatterViolation("---\nname: deploy\n---\nsteps\n")).toContain("description")
  })

  it("#given a file without frontmatter #then the violation names the delimiter", () => {
    expect(describeFrontmatterViolation("just a body\n")).toContain("---")
  })
})

describe("strict-YAML oracle: every header the gate accepts reads identically through the yaml package", () => {
  const accepted = [
    "description: A note about the project",
    "description: 2026-09-10 outage on the build host",
    "description: senpi#1439 keeps a hash that no space precedes, as does a#b",
    "description: a:b keeps the colon when no space follows",
    "description: yes",
    "description: 1_000 is a string in the core schema",
    'description: "by default: verify \\"quoted\\" \\u00e9\\ttab"',
    "description: 'it''s single quoted'",
    'description: Person - X\nkind: person\naliases: ["A: B","C"]',
    "name: deploy\ndescription: Use when deploying\nversion: 0.2.0\ndeprecated: true\nread_only: false",
    `description: ${"x".repeat(MAX_DESCRIPTION_LENGTH)}`,
  ]
  for (const header of accepted) {
    it(`#given ${JSON.stringify(header.slice(0, 60))} #then yaml.parse agrees with the memory reader`, () => {
      const content = `---\n${header}\n---\nbody\n`
      expect(describeFrontmatterViolation(content)).toBeNull()
      const strict = parseYaml(header) as Record<string, unknown>
      const parsed = parseMemoryFile(content).frontmatter
      expect(strict.description).toBe(parsed.description)
      if (parsed.kind !== undefined) expect(strict.kind).toBe(parsed.kind)
      if (parsed.aliases !== undefined) expect(strict.aliases).toEqual([...parsed.aliases])
      if (parsed.read_only !== undefined) expect(String(strict.read_only)).toBe(parsed.read_only)
      for (const key of Object.keys(parsed.extra ?? {})) expect(key in strict).toBe(true)
    })
  }

  const rejected = [
    "description: by default: verify",
    "description: senpi #1439 tail",
    "description: true",
    "description: 1.0",
    "description: [bracketed]",
    "description: trailing colon:",
    "description: - dash",
  ]
  for (const header of rejected) {
    it(`#given ${JSON.stringify(header)} #then the gate rejects what yaml would misread or refuse`, () => {
      expect(describeFrontmatterViolation(`---\n${header}\n---\nbody\n`)).not.toBeNull()
      const raw = header.slice("description: ".length)
      let strict: unknown
      try {
        strict = (parseYaml(header) as Record<string, unknown>).description
      } catch {
        strict = undefined
      }
      expect(strict).not.toBe(raw)
    })
  }
})
