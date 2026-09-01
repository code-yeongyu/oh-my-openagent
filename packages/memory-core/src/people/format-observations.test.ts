import { describe, it, expect } from "bun:test"
import {
  parsePeopleCard,
  serializePeopleCard,
  type PeopleCard,
} from "./format"

describe("observation entry format (IC-16)", () => {
  const limits = { maxEntries: 40, maxEntryChars: 200 }

  describe("#given an explicit observation with full comment fields", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Prefers dark mode <!-- src: msg-001; n=2; pattern: repeated; confidence: high; status: open -->',
    ].join("\n")

    it("#then parsePeopleCard extracts the section and entry", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics).toEqual([])
      expect((result.card.observations ?? [])).toHaveLength(1)
      expect((result.card.observations ?? [])[0].section).toBe("Explicit")
      expect((result.card.observations ?? [])[0].entries[0].date).toBe("2026-01-15")
      expect((result.card.observations ?? [])[0].entries[0].content).toBe("Prefers dark mode")
      expect((result.card.observations ?? [])[0].entries[0].src).toBe("msg-001")
      expect((result.card.observations ?? [])[0].entries[0].n).toBe(2)
      expect((result.card.observations ?? [])[0].entries[0].pattern).toBe("repeated")
      expect((result.card.observations ?? [])[0].entries[0].confidence).toBe("high")
      expect((result.card.observations ?? [])[0].entries[0].status).toBe("open")
    })
  })

  describe("#given an observation with minimal fields (just src)", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Some fact <!-- src: msg-001 -->',
    ].join("\n")

    it("#then parsePeopleCard extracts with optional fields undefined", () => {
      const result = parsePeopleCard(text, limits)

      expect((result.card.observations ?? [])[0].entries[0].src).toBe("msg-001")
      expect((result.card.observations ?? [])[0].entries[0].n).toBeUndefined()
      expect((result.card.observations ?? [])[0].entries[0].pattern).toBeUndefined()
      expect((result.card.observations ?? [])[0].entries[0].confidence).toBeUndefined()
      expect((result.card.observations ?? [])[0].entries[0].status).toBeUndefined()
    })
  })

  describe("#given an observation with no comment at all", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Plain fact',
    ].join("\n")

    it("#then parsePeopleCard extracts with all comment fields undefined", () => {
      const result = parsePeopleCard(text, limits)

      expect((result.card.observations ?? [])[0].entries[0].content).toBe("Plain fact")
      expect((result.card.observations ?? [])[0].entries[0].src).toBeUndefined()
    })
  })

  describe("#given observations in multiple sections", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Fact A <!-- src: a -->',
      "",
      "## Deductive",
      "",
      '- [2026-01-16] Inference B <!-- src: b; confidence: medium -->',
    ].join("\n")

    it("#then parsePeopleCard separates them by section", () => {
      const result = parsePeopleCard(text, limits)

      expect((result.card.observations ?? [])).toHaveLength(2)
      expect((result.card.observations ?? [])[0].section).toBe("Explicit")
      expect((result.card.observations ?? [])[0].entries).toHaveLength(1)
      expect((result.card.observations ?? [])[1].section).toBe("Deductive")
      expect((result.card.observations ?? [])[1].entries).toHaveLength(1)
    })
  })

  describe("#given an observation entry with n= but no src", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Reinforced fact <!-- n=3 -->',
    ].join("\n")

    it("#then parsePeopleCard extracts n without src", () => {
      const result = parsePeopleCard(text, limits)

      expect((result.card.observations ?? [])[0].entries[0].n).toBe(3)
      expect((result.card.observations ?? [])[0].entries[0].src).toBeUndefined()
    })
  })

  describe("#given an observation entry with multiple src ids", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Multi-source fact <!-- src: msg-001,msg-002; n=2 -->',
    ].join("\n")

    it("#then parsePeopleCard preserves the full src string", () => {
      const result = parsePeopleCard(text, limits)

      expect((result.card.observations ?? [])[0].entries[0].src).toBe("msg-001,msg-002")
      expect((result.card.observations ?? [])[0].entries[0].n).toBe(2)
    })
  })

  describe("#given serializePeopleCard with observations", () => {
    const card: PeopleCard = {
      entries: [
        { prefix: "IDENTITY", content: "Engineer" },
      ],
      observations: [
        {
          section: "Explicit",
          entries: [
            {
              date: "2026-01-15",
              content: "Prefers dark mode",
              src: "msg-001",
              n: 2,
              pattern: "repeated",
              confidence: "high",
              status: "open",
            },
          ],
        },
      ],
    }

    it("#then produces a parseable card with both entries and observations", () => {
      const serialized = serializePeopleCard(card, limits)
      const reparsed = parsePeopleCard(serialized, limits)

      expect(reparsed.card.entries).toEqual(card.entries)
      expect(reparsed.card.observations).toEqual(card.observations)
    })
  })

  describe("#given a mixed card with entries and observations", () => {
    const text = [
      "IDENTITY: Engineer",
      "ATTRIBUTE: Likes dogs",
      "",
      "## Explicit",
      "",
      '- [2026-01-15] Fact <!-- src: m1 -->',
    ].join("\n")

    it("#then parsePeopleCard extracts both entries and observations", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.card.entries).toHaveLength(2)
      expect((result.card.observations ?? [])).toHaveLength(1)
      expect(result.diagnostics).toEqual([])
    })

    it("#then serializePeopleCard round-trips both", () => {
      const result = parsePeopleCard(text, limits)
      const serialized = serializePeopleCard(result.card, limits)
      const reparsed = parsePeopleCard(serialized, limits)

      expect(reparsed.card).toEqual(result.card)
    })
  })

  describe("#given an unknown observation section", () => {
    const text = [
      "## Explicit",
      "",
      '- [2026-01-15] Fact <!-- src: m1 -->',
      "",
      "## Unknown",
      "",
      '- [2026-01-16] Mystery <!-- src: m2 -->',
    ].join("\n")

    it("#then parsePeopleCard returns a diagnostic for the unknown section", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics[0]).toContain("Unknown")
    })
  })

  describe("#given an observation entry without a date bracket", () => {
    const text = [
      "## Explicit",
      "",
      "- No date fact <!-- src: m1 -->",
    ].join("\n")

    it("#then parsePeopleCard flags it as a diagnostic", () => {
      const result = parsePeopleCard(text, limits)

      expect(result.diagnostics.length).toBeGreaterThan(0)
    })
  })
})
