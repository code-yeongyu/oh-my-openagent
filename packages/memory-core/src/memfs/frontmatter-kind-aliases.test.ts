import { describe, it, expect } from "bun:test"
import {
  parseMemoryFile,
  renderMemoryFile,
  FrontmatterError,
} from "./frontmatter"

describe("frontmatter kind + aliases (IC-13)", () => {
  describe("#given a file with kind and aliases", () => {
    const content = [
      "---",
      'description: Person - Yeongyu',
      "kind: person",
      'aliases: ["Yeongyu","YG"]',
      "---",
      "Body text.",
    ].join("\n")

    it("#then parseMemoryFile extracts kind and aliases", () => {
      const parsed = parseMemoryFile(content)

      expect(parsed.frontmatter.description).toBe("Person - Yeongyu")
      expect(parsed.frontmatter.kind).toBe("person")
      expect(parsed.frontmatter.aliases).toEqual(["Yeongyu", "YG"])
      expect(parsed.body).toBe("Body text.")
    })

    it("#then renderMemoryFile emits kind then aliases after description", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)

      expect(rendered).toContain("description: Person - Yeongyu")
      expect(rendered).toContain("kind: person")
      expect(rendered).toContain('aliases: ["Yeongyu","YG"]')
      // kind before aliases, both after description
      const descIdx = rendered.indexOf("description:")
      const kindIdx = rendered.indexOf("kind:")
      const aliasesIdx = rendered.indexOf("aliases:")
      expect(descIdx).toBeLessThan(kindIdx)
      expect(kindIdx).toBeLessThan(aliasesIdx)
    })

    it("#then round-trip parse -> render -> parse is stable", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)
      const reparsed = parseMemoryFile(rendered)

      expect(reparsed).toEqual(parsed)
    })
  })

  describe("#given a file with kind but no aliases", () => {
    const content = [
      "---",
      "description: Person - Solo",
      "kind: person",
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile extracts kind and leaves aliases undefined", () => {
      const parsed = parseMemoryFile(content)

      expect(parsed.frontmatter.kind).toBe("person")
      expect(parsed.frontmatter.aliases).toBeUndefined()
    })

    it("#then renderMemoryFile omits aliases when undefined", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)

      expect(rendered).not.toContain("aliases:")
    })
  })

  describe("#given a file with aliases but no kind", () => {
    const content = [
      "---",
      "description: Person - Aliased",
      'aliases: ["A","B"]',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile extracts aliases and leaves kind undefined", () => {
      const parsed = parseMemoryFile(content)

      expect(parsed.frontmatter.kind).toBeUndefined()
      expect(parsed.frontmatter.aliases).toEqual(["A", "B"])
    })

    it("#then renderMemoryFile omits kind when undefined", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)

      expect(rendered).not.toContain("kind:")
    })
  })

  describe("#given a file with read_only, kind, and aliases together", () => {
    const content = [
      "---",
      "description: Full frontmatter",
      "read_only: true",
      "kind: person",
      'aliases: ["X"]',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile preserves all fields", () => {
      const parsed = parseMemoryFile(content)

      expect(parsed.frontmatter.description).toBe("Full frontmatter")
      expect(parsed.frontmatter.read_only).toBe("true")
      expect(parsed.frontmatter.kind).toBe("person")
      expect(parsed.frontmatter.aliases).toEqual(["X"])
    })

    it("#then renderMemoryFile emits all fields in order", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)
      const reparsed = parseMemoryFile(rendered)

      expect(reparsed).toEqual(parsed)
    })
  })

  describe("#given aliases that is not a JSON array", () => {
    const content = [
      "---",
      "description: Bad aliases",
      "aliases: Yeongyu",
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError)
    })
  })

  describe("#given aliases that is a JSON array with empty strings", () => {
    const content = [
      "---",
      "description: Bad aliases",
      'aliases: ["A",""]',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError)
    })
  })

  describe("#given aliases that is a JSON array of non-strings", () => {
    const content = [
      "---",
      "description: Bad aliases",
      'aliases: [1,2,3]',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError)
    })
  })

  describe("#given aliases that is a JSON object (not array)", () => {
    const content = [
      "---",
      "description: Bad aliases",
      'aliases: {"key":"val"}',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError)
    })
  })

  describe("#given a card edit via str_replace keeps kind+aliases (IC-13 round-trip through memory tool)", () => {
    const content = [
      "---",
      'description: Person - Yeongyu',
      "kind: person",
      'aliases: ["Yeongyu","YG"]',
      "---",
      "IDENTITY: Software engineer",
    ].join("\n")

    it("#then parse -> render -> parse preserves kind+aliases through body edit", () => {
      // simulate str_replace: parse, change body, render, parse again
      const parsed = parseMemoryFile(content)
      const newBody = parsed.body.replace("Software engineer", "Senior engineer")
      const rendered = renderMemoryFile(parsed.frontmatter, newBody)
      const reparsed = parseMemoryFile(rendered)

      expect(reparsed.frontmatter.kind).toBe("person")
      expect(reparsed.frontmatter.aliases).toEqual(["Yeongyu", "YG"])
      expect(reparsed.body).toBe("IDENTITY: Senior engineer")
    })
  })

  describe("#given a card edit via apply_patch keeps kind+aliases (IC-13 round-trip)", () => {
    const content = [
      "---",
      'description: Person - Yeongyu',
      "kind: person",
      'aliases: ["Yeongyu","YG"]',
      "---",
      "IDENTITY: Engineer",
    ].join("\n")

    it("#then the full file round-trips through parse+render preserving frontmatter", () => {
      // apply_patch operates on raw file text; the key invariant is that
      // renderMemoryFile preserves all frontmatter fields
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)
      const reparsed = parseMemoryFile(rendered)

      expect(reparsed).toEqual(parsed)
    })
  })

  describe("#given an empty aliases array", () => {
    const content = [
      "---",
      "description: Empty aliases",
      'aliases: []',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile accepts it as an empty array", () => {
      const parsed = parseMemoryFile(content)

      expect(parsed.frontmatter.aliases).toEqual([])
    })

    it("#then renderMemoryFile round-trips empty aliases", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)
      const reparsed = parseMemoryFile(rendered)

      expect(reparsed).toEqual(parsed)
    })
  })

  describe("#given kind as a multi-word value", () => {
    const content = [
      "---",
      "description: Typed",
      "kind: something complex",
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile preserves kind verbatim", () => {
      const parsed = parseMemoryFile(content)

      expect(parsed.frontmatter.kind).toBe("something complex")
    })
  })

  describe("#given aliases with special characters in names", () => {
    const content = [
      "---",
      "description: Special",
      'aliases: ["O\u0027Brien","Name with spaces"]',
      "---",
      "Body.",
    ].join("\n")

    it("#then parseMemoryFile preserves them through round-trip", () => {
      const parsed = parseMemoryFile(content)
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body)
      const reparsed = parseMemoryFile(rendered)

      expect(reparsed.frontmatter.aliases).toEqual(["O'Brien", "Name with spaces"])
    })
  })
})
