import { describe, expect, test } from "bun:test"
import {
  ANSWERED_BY,
  DEFECT_CODES,
  DELIVERABLE_FORMATS,
  DELIVERABLE_STATUSES,
  DESIGN_SPEC_SECTIONS,
  FIDELITY_CODES,
  GATE_NAMES,
  GATE_STATUSES,
  INTEGRITY_CODES,
  LANES,
  LAYOUT_CODES,
  LINEAGE_MODES,
  MANIFEST_CODES,
  REPAIR_DEFAULTS,
  STATES,
  STATIC_CODES,
  validateOutcomeManifest,
} from "./contracts.mjs"
import {
  SEVERITIES,
  STATIC_CODES_EXPECTED,
  LAYOUT_CODES_EXPECTED,
  FIDELITY_BLOCKERS,
  FIDELITY_MAJORS,
  FIDELITY_MINORS,
  FIDELITY_CODES_EXPECTED,
  sampleManifest,
} from "./tests/contracts-support"

describe("DEFECT_CODES", () => {
  test("#given the code table #when every code is inspected #then it has a severity, a hint, and an integrity flag", () => {
    expect(Object.keys(DEFECT_CODES).sort()).toEqual(
      [
        ...STATIC_CODES_EXPECTED,
        "missing_promised_deliverable",
        ...LAYOUT_CODES_EXPECTED,
        ...FIDELITY_CODES_EXPECTED,
        "conversion_altered_number",
        "unit_unbound",
      ].sort(),
    )
    for (const [code, entry] of Object.entries(DEFECT_CODES)) {
      expect(SEVERITIES.has(entry.severity), `${code} severity`).toBe(true)
      expect(typeof entry.hint).toBe("string")
      expect(entry.hint.length).toBeGreaterThan(10)
      expect(typeof entry.integrity).toBe("boolean")
    }
  })

  test("#given the code table #when integrity codes are derived #then they are exactly the blocker codes", () => {
    expect([...INTEGRITY_CODES].sort()).toEqual(
      [
        "broken_asset_reference",
        "missing_citation_section",
        "missing_closing_section",
        "missing_promised_deliverable",
        "missing_required_section",
        ...FIDELITY_BLOCKERS,
        "conversion_altered_number",
      ].sort(),
    )
    for (const code of INTEGRITY_CODES) expect(DEFECT_CODES[code].severity).toBe("blocker")
    for (const [code, entry] of Object.entries(DEFECT_CODES)) {
      if (entry.severity === "blocker") expect(INTEGRITY_CODES.has(code), `${code} must be integrity`).toBe(true)
    }
  })

  test("#given the frozen table #when a severity write is attempted #then it throws and the value is unchanged", () => {
    expect(Object.isFrozen(DEFECT_CODES)).toBe(true)
    expect(Object.isFrozen(DEFECT_CODES.korean_no_keep_all)).toBe(true)
    expect(() => {
      "use strict"
      DEFECT_CODES.korean_no_keep_all.severity = "minor"
    }).toThrow()
    expect(DEFECT_CODES.korean_no_keep_all.severity).toBe("major")
  })

  test("#given the fidelity codes #when inspected #then each carries its fixed severity and integrity flag", () => {
    for (const code of FIDELITY_BLOCKERS)
      expect([code, DEFECT_CODES[code]?.severity, DEFECT_CODES[code]?.integrity]).toEqual([code, "blocker", true])
    expect([
      DEFECT_CODES.conversion_altered_number?.severity,
      DEFECT_CODES.conversion_altered_number?.integrity,
    ]).toEqual(["blocker", true])
    for (const code of FIDELITY_MAJORS)
      expect([code, DEFECT_CODES[code]?.severity, DEFECT_CODES[code]?.integrity]).toEqual([code, "major", false])
    for (const code of FIDELITY_MINORS)
      expect([code, DEFECT_CODES[code]?.severity, DEFECT_CODES[code]?.integrity]).toEqual([code, "minor", false])
    expect([DEFECT_CODES.unit_unbound?.severity, DEFECT_CODES.unit_unbound?.integrity]).toEqual(["minor", false])
    expect(DEFECT_CODES).not.toHaveProperty("incompatible_populations")
  })
})

describe("code groups", () => {
  test("#given the code groups #when unioned #then they partition the code table exactly", () => {
    expect([...STATIC_CODES].sort()).toEqual(STATIC_CODES_EXPECTED.slice().sort())
    expect([...LAYOUT_CODES].sort()).toEqual(LAYOUT_CODES_EXPECTED.slice().sort())
    expect([...MANIFEST_CODES]).toEqual(["missing_promised_deliverable"])
    expect([...FIDELITY_CODES].sort()).toEqual(
      [...FIDELITY_CODES_EXPECTED, "conversion_altered_number", "unit_unbound"].sort(),
    )
    const union = [...STATIC_CODES, ...LAYOUT_CODES, ...MANIFEST_CODES, ...FIDELITY_CODES].sort()
    expect(union).toEqual(Object.keys(DEFECT_CODES).sort())
    expect(new Set(union).size).toBe(union.length)
    expect(Object.isFrozen(STATIC_CODES)).toBe(true)
    expect(Object.isFrozen(FIDELITY_CODES)).toBe(true)
  })
})

describe("enums", () => {
  test("#given the vocabulary #when read #then lanes, states, formats, statuses, gates, lineage modes are fixed lists", () => {
    expect(LANES).toEqual(["template-strict", "template-vibe", "no-format", "edit-existing"])
    expect(STATES).toEqual(["none", "partial", "complete"])
    expect(DELIVERABLE_FORMATS).toEqual(["pdf", "docx", "html", "md", "latex", "slides", "post"])
    expect(DELIVERABLE_STATUSES).toEqual(["pending", "delivered", "blocked_capability", "skipped", "failed"])
    expect(GATE_NAMES).toEqual(["static", "fidelity", "layout", "visual", "proofread"])
    expect(ANSWERED_BY).toEqual(["user", "default", "request", "pending"])
    expect(GATE_STATUSES).toEqual(["pass", "fail", "not_run"])
    expect(LINEAGE_MODES).toEqual(["inline", "section"])
    expect(DESIGN_SPEC_SECTIONS).toEqual([
      "Extracted from",
      "Tokens",
      "Typography",
      "Layout",
      "Structure",
      "Figures",
      "Citations",
      "Open questions",
    ])
    expect(REPAIR_DEFAULTS).toEqual({ maxAttempts: 3, plateauLimit: 2, wallClockMs: 900_000 })
    expect(Object.isFrozen(LANES)).toBe(true)
    expect(Object.isFrozen(REPAIR_DEFAULTS)).toBe(true)
  })
})

describe("validateOutcomeManifest", () => {
  test("#given a well-formed manifest #when validated #then it passes", () => {
    expect(validateOutcomeManifest(sampleManifest())).toEqual({ ok: true, errors: [] })
  })

  test("#given a gate with an unknown value #when validated #then it fails", () => {
    const m = sampleManifest()
    m.gates.static = "ok"
    expect(validateOutcomeManifest(m).ok).toBe(false)
  })
})

describe("validateRepairState", () => {})
