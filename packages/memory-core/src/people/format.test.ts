import { describe, it, expect } from "bun:test"
import {
  parsePeopleCard,
  serializePeopleCard,
  type PeopleCard,
} from "./format"

describe("people card format (IC-16)", () => {
  const limits = { maxEntries: 40, maxEntryChars: 200 }

  describe("#given a well-formed card with all four prefix types", () => {
    const text = [
      "IDENTITY: Software engineer",
      "ATTRIBUTE: Prefers concise code",
      "RELATIONSHIP: collaborates: jane-doe",
      "INSTRUCTION: Always cite sources",
    ].join("\n")

    it("#then parsePeopleCard extracts all entries with their prefixes", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics).toEqual([])
      expect(result.card.entries).toHaveLength(4)
      expect(result.card.entries[0]).toEqual({
        prefix: "IDENTITY",
        content: "Software engineer",
      })
      expect(result.card.entries[1]).toEqual({
        prefix: "ATTRIBUTE",
        content: "Prefers concise code",
      })
      expect(result.card.entries[2]).toEqual({
        prefix: "RELATIONSHIP",
        content: "collaborates: jane-doe",
      })
      expect(result.card.entries[3]).toEqual({
        prefix: "INSTRUCTION",
        content: "Always cite sources",
      })
    })

    it("#then serializePeopleCard round-trips stably", () => {
      const result = parsePeopleCard(text, limits)
      const serialized = serializePeopleCard(result.card, limits)
      const reparsed = parsePeopleCard(serialized, limits)

      expect(reparsed.card).toEqual(result.card)
    })
  })

  describe("#given a card with blank lines between entries", () => {
    const text = [
      "IDENTITY: Engineer",
      "",
      "ATTRIBUTE: Likes dogs",
    ].join("\n")

    it("#then parsePeopleCard skips blank lines", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries).toHaveLength(2)
      expect(result.diagnostics).toEqual([])
    })
  })

  describe("#given a card with a comment-only line", () => {
    const text = [
      "IDENTITY: Engineer",
      "# this is a comment",
      "ATTRIBUTE: Likes dogs",
    ].join("\n")

    it("#then parsePeopleCard skips comment lines without diagnostics", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries).toHaveLength(2)
      expect(result.diagnostics).toEqual([])
    })
  })

  describe("#given an invalid prefix line", () => {
    const text = [
      "IDENTITY: Engineer",
      "BADPREFIX: something",
    ].join("\n")

    it("#then parsePeopleCard returns a diagnostic instead of throwing", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics[0]).toContain("BADPREFIX")
    })

    it("#then parsePeopleCard still parses valid entries", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries).toHaveLength(1)
      expect(result.card.entries[0].prefix).toBe("IDENTITY")
    })
  })

  describe("#given an entry exceeding maxEntryChars", () => {
    const longContent = "x".repeat(201)
    const text = `IDENTITY: ${longContent}`

    it("#then parsePeopleCard flags the entry as a diagnostic", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics[0]).toContain("200")
    })
  })

  describe("#given entries exceeding maxEntries", () => {
    const lines: string[] = []
    for (let i = 0; i < 45; i++) {
      lines.push(`ATTRIBUTE: value ${i}`)
    }

    it("#then parsePeopleCard flags the overflow as a diagnostic", () => {
      const result = parsePeopleCard(lines.join("\n"), limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics[0]).toContain("40")
    })
  })

  describe("#given an entry at exactly maxEntryChars", () => {
    const content = "x".repeat(200)
    const text = `IDENTITY: ${content}`

    it("#then parsePeopleCard does not flag it", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics).toEqual([])
      expect(result.card.entries).toHaveLength(1)
    })
  })

  describe("#given an empty card", () => {
    const text = ""

    it("#then parsePeopleCard yields no entries and no diagnostics", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries).toEqual([])
      expect(result.diagnostics).toEqual([])
    })
  })

  describe("#given a card with trailing whitespace on lines", () => {
    const text = "IDENTITY: Engineer   \nATTRIBUTE: Likes dogs   "

    it("#then parsePeopleCard trims trailing whitespace", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries[0].content).toBe("Engineer")
      expect(result.card.entries[1].content).toBe("Likes dogs")
    })
  })

  describe("#given serializePeopleCard with entries", () => {
    const card: PeopleCard = {
      entries: [
        { prefix: "IDENTITY", content: "Engineer" },
        { prefix: "ATTRIBUTE", content: "Likes dogs" },
      ],
    }

    it("#then produces one line per entry", () => {
      const serialized = serializePeopleCard(card, limits)

      expect(serialized).toBe("IDENTITY: Engineer\nATTRIBUTE: Likes dogs")
    })
  })

  describe("#given serializePeopleCard with an empty card", () => {
    const card: PeopleCard = { entries: [] }

    it("#then produces an empty string", () => {
      const serialized = serializePeopleCard(card, limits)

      expect(serialized).toBe("")
    })
  })

  describe("#given a RELATIONSHIP entry", () => {
    const text = "RELATIONSHIP: works-with: jane-doe"

    it("#then parsePeopleCard preserves the full content including predicate", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries[0].prefix).toBe("RELATIONSHIP")
      expect(result.card.entries[0].content).toBe("works-with: jane-doe")
    })
  })

  describe("#given a line with prefix but no content", () => {
    const text = "IDENTITY:"

    it("#then parsePeopleCard flags it as a diagnostic", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
    })
  })

  describe("#given a line with prefix and only whitespace content", () => {
    const text = "IDENTITY:   "

    it("#then parsePeopleCard flags it as a diagnostic", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
    })
  })
})
