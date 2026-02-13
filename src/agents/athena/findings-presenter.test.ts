import { describe, expect, test } from "bun:test"
import type { SynthesisResult } from "./synthesis-types"
import { formatFindingsForUser } from "./findings-presenter"

function createSynthesisResult(overrides?: Partial<SynthesisResult>): SynthesisResult {
  return {
    question: "Review the Athena council outputs for actionable risks",
    findings: [
      {
        summary: "Validate configuration before execution",
        details: "Missing guard clauses can allow invalid member configs.",
        agreementLevel: "majority",
        reportedBy: ["OpenAI", "Claude"],
        assessment: {
          agrees: true,
          rationale: "This aligns with repeated failures observed in setup paths.",
        },
        isFalsePositiveRisk: false,
      },
      {
        summary: "Retry strategy lacks upper bounds",
        details: "Unbounded retries may cause runaway background tasks.",
        agreementLevel: "solo",
        reportedBy: ["Gemini"],
        assessment: {
          agrees: false,
          rationale: "Current retry count is already constrained in most flows.",
        },
        isFalsePositiveRisk: true,
      },
      {
        summary: "Preserve partial successes",
        details: "Do not fail entire council run when one member errors.",
        agreementLevel: "unanimous",
        reportedBy: ["OpenAI", "Claude", "Gemini"],
        assessment: {
          agrees: true,
          rationale: "This is required for resilient multi-model orchestration.",
        },
        isFalsePositiveRisk: false,
      },
      {
        summary: "Reduce prompt token duplication",
        details: "Duplicate context blocks increase cost without improving quality.",
        agreementLevel: "minority",
        reportedBy: ["Claude"],
        assessment: {
          agrees: true,
          rationale: "Consolidation should lower cost while preserving intent.",
        },
        isFalsePositiveRisk: false,
      },
    ],
    memberProvenance: [],
    totalFindings: 4,
    consensusCount: 2,
    outlierCount: 1,
    ...overrides,
  }
}

describe("formatFindingsForUser", () => {
  //#given findings across all agreement levels
  //#when formatFindingsForUser is called
  //#then groups appear in deterministic order: unanimous, majority, minority, solo
  test("groups findings by agreement level in required order", () => {
    const result = createSynthesisResult()

    const output = formatFindingsForUser(result)

    const unanimousIndex = output.indexOf("## Unanimous Findings")
    const majorityIndex = output.indexOf("## Majority Findings")
    const minorityIndex = output.indexOf("## Minority Findings")
    const soloIndex = output.indexOf("## Solo Findings")

    expect(unanimousIndex).toBeGreaterThan(-1)
    expect(majorityIndex).toBeGreaterThan(unanimousIndex)
    expect(minorityIndex).toBeGreaterThan(majorityIndex)
    expect(soloIndex).toBeGreaterThan(minorityIndex)
  })

  //#given a finding with assessment details
  //#when formatting is generated
  //#then each finding includes summary, details, reported-by, and Athena rationale
  test("renders finding body and Athena assessment rationale", () => {
    const result = createSynthesisResult()

    const output = formatFindingsForUser(result)

    expect(output).toContain("Validate configuration before execution")
    expect(output).toContain("Missing guard clauses can allow invalid member configs.")
    expect(output).toContain("Reported by: OpenAI, Claude")
    expect(output).toContain("Athena assessment: Agrees")
    expect(output).toContain("Rationale: This aligns with repeated failures observed in setup paths.")
  })

  //#given a solo finding flagged as false-positive risk
  //#when formatting is generated
  //#then a visible warning marker is included
  test("shows false-positive warning for risky solo findings", () => {
    const result = createSynthesisResult()

    const output = formatFindingsForUser(result)

    expect(output).toContain("[False Positive Risk]")
    expect(output).toContain("Retry strategy lacks upper bounds")
  })

  //#given no findings
  //#when formatFindingsForUser is called
  //#then output includes a graceful no-findings message
  test("handles empty findings with a no-findings message", () => {
    const result = createSynthesisResult({ findings: [], totalFindings: 0, consensusCount: 0, outlierCount: 0 })

    const output = formatFindingsForUser(result)

    expect(output).toContain("No synthesized findings are available")
  })

  //#given multiple majority findings with different reporter counts
  //#when formatting is generated
  //#then group header shows the agreement level label without a misleading single count
  test("shows agreement level label in group header without single-finding count", () => {
    const result = createSynthesisResult({
      findings: [
        {
          summary: "Finding A",
          details: "Reported by 3 members",
          agreementLevel: "majority",
          reportedBy: ["OpenAI", "Claude", "Gemini"],
          assessment: { agrees: true, rationale: "Valid" },
          isFalsePositiveRisk: false,
        },
        {
          summary: "Finding B",
          details: "Reported by 2 members",
          agreementLevel: "majority",
          reportedBy: ["OpenAI", "Claude"],
          assessment: { agrees: true, rationale: "Also valid" },
          isFalsePositiveRisk: false,
        },
      ],
    })

    const output = formatFindingsForUser(result)

    // The header should show the level label without a misleading single-finding count
    // It should NOT use the first finding's count as the group header
    expect(output).not.toContain("## Majority Findings (3 members report this (majority))")
    expect(output).toContain("## Majority Findings")
    // Each individual finding still shows its own agreement context
    expect(output).toContain("Agreement context: 3 members report this (majority)")
    expect(output).toContain("Agreement context: 2 members report this (majority)")
  })

  //#given a non-empty findings result
  //#when formatting is generated
  //#then output ends with an action recommendation section
  test("includes a final action recommendation section", () => {
    const result = createSynthesisResult()

    const output = formatFindingsForUser(result)

    expect(output.trimEnd()).toMatch(/## Action Recommendation[\s\S]*$/)
    expect(output).toContain("Prioritize unanimous and majority findings")
  })
})
