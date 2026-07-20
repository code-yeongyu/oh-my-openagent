import { describe, expect, it } from "bun:test"
import { generateReport, generateDisclosureReport, generateSummaryReport } from "./disclosure-report"
import type { Mission } from "./types"

function makeMission(findings: Mission["findings"]): Mission {
  return {
    id: "sec-test",
    name: "Test Mission",
    objective: "Test objective",
    scope: {
      allowed_hosts: [{ host: "target.example.com" }],
      allowed_paths: [],
      allow_loopback: false,
      allow_private: false,
    },
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    findings,
  }
}

describe("generateSummaryReport", () => {
  it("#given mission with findings -> #when generate -> #then includes title and counts", () => {
    // given
    const mission = makeMission([
      {
        id: "find-1",
        title: "SQL Injection",
        description: "Unsanitized input",
        severity: "high",
        evidence: [{ kind: "output", content: "error" }],
        evidence_level: "source-verified",
        references: [],
        discovered_at: "2026-01-01T00:00:00.000Z",
        verified_at: "2026-01-01T00:00:00.000Z",
        status: "verified",
      },
    ])

    // when
    const report = generateSummaryReport(mission)

    // then
    expect(report).toContain("Security Mission Report: Test Mission")
    expect(report).toContain("SQL Injection")
    expect(report).toContain("1 findings")
  })
})

describe("generateDisclosureReport", () => {
  it("#given no verified findings -> #when generate -> #then states no findings to disclose", () => {
    // given
    const mission = makeMission([
      {
        id: "find-1",
        title: "Claimed Issue",
        description: "Model assertion",
        severity: "high",
        evidence: [],
        evidence_level: "claimed",
        references: [],
        discovered_at: "2026-01-01T00:00:00.000Z",
        status: "claimed",
      },
    ])

    // when
    const report = generateDisclosureReport(mission)

    // then
    expect(report).toContain("No verified findings")
    expect(report).toContain("provenance gate")
  })

  it("#given verified findings -> #when generate -> #then includes findings and human-review disclaimer", () => {
    // given
    const mission = makeMission([
      {
        id: "find-1",
        title: "XSS Vulnerability",
        description: "Reflected XSS in search",
        severity: "high",
        cwe: "CWE-79",
        evidence: [{ kind: "output", content: "<script>alert(1)</script>" }],
        evidence_level: "source-verified",
        references: ["https://owasp.org/www-community/attacks/xss/"],
        discovered_at: "2026-01-01T00:00:00.000Z",
        verified_at: "2026-01-01T00:00:00.000Z",
        status: "verified",
        verify_gate: {
          passed: true,
          provenance: "tool",
          reasons: [],
          checked_at: "2026-01-01T00:00:00.000Z",
        },
      },
    ])

    // when
    const report = generateDisclosureReport(mission)

    // then
    expect(report).toContain("XSS Vulnerability")
    expect(report).toContain("CWE-79")
    expect(report).toContain("Provenance Gate")
    expect(report).toContain("human must review")
  })
})

describe("generateReport", () => {
  it("#given summary format -> #when generate -> #then returns summary", () => {
    // given
    const mission = makeMission([])

    // when
    const report = generateReport(mission, "summary")

    // then
    expect(report).toContain("Security Mission Report")
  })

  it("#given disclosure format -> #when generate -> #then returns disclosure draft", () => {
    // given
    const mission = makeMission([])

    // when
    const report = generateReport(mission, "disclosure")

    // then
    expect(report).toContain("Coordinated Disclosure Draft")
  })
})
