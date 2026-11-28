import type { Finding, Mission } from "./types"

const SEVERITY_ORDER: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

const EVIDENCE_LEVEL_ORDER: Record<string, number> = {
  "poc-executed": 4,
  "poc-built": 3,
  "source-verified": 2,
  claimed: 1,
}

function sortBySeverity(a: Finding, b: Finding): number {
  return (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
}

export function generateSummaryReport(mission: Mission): string {
  const verified = mission.findings.filter((f) => f.status === "verified")
  const claimed = mission.findings.filter((f) => f.status === "claimed")
  const refuted = mission.findings.filter((f) => f.status === "refuted")

  const lines: string[] = [
    `# Security Mission Report: ${mission.name}`,
    "",
    `**Mission ID:** ${mission.id}`,
    `**Objective:** ${mission.objective}`,
    `**Status:** ${mission.status}`,
    `**Created:** ${mission.created_at}`,
    "",
    "## Findings Summary",
    "",
    `| Severity | Verified | Claimed | Refuted |`,
    `|----------|----------|---------|---------|`,
  ]

  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    const v = verified.filter((f) => f.severity === sev).length
    const c = claimed.filter((f) => f.severity === sev).length
    const r = refuted.filter((f) => f.severity === sev).length
    if (v + c + r > 0) {
      lines.push(`| ${sev} | ${v} | ${c} | ${r} |`)
    }
  }

  lines.push("", `**Total:** ${mission.findings.length} findings (${verified.length} verified)`)

  if (verified.length > 0) {
    lines.push("", "## Verified Findings", "")
    for (const f of verified.sort(sortBySeverity)) {
      lines.push(`### ${f.title}`, "")
      lines.push(`- **ID:** ${f.id}`)
      lines.push(`- **Severity:** ${f.severity}`)
      if (f.cwe) lines.push(`- **CWE:** ${f.cwe}`)
      lines.push(`- **Evidence Level:** ${f.evidence_level}`)
      lines.push(`- **Description:** ${f.description}`)
      if (f.remediation) lines.push(`- **Remediation:** ${f.remediation}`)
      lines.push("")
    }
  }

  return lines.join("\n")
}

export function generateDisclosureReport(mission: Mission): string {
  const verified = mission.findings
    .filter((f) => f.status === "verified")
    .sort(sortBySeverity)

  if (verified.length === 0) {
    return [
      `# Coordinated Disclosure Draft: ${mission.name}`,
      "",
      "**No verified findings to disclose.**",
      "",
      "A finding is only eligible for disclosure when it passes the provenance gate (tool-backed evidence). Model-asserted findings without tool output are excluded.",
    ].join("\n")
  }

  const lines: string[] = [
    `# Coordinated Disclosure Draft: ${mission.name}`,
    "",
    `**Mission ID:** ${mission.id}`,
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "> This is a draft. A human must review and send it. Do not send automatically.",
    "",
    "## Scope",
    "",
    `- **Objective:** ${mission.objective}`,
    `- **Allowed hosts:** ${mission.scope.allowed_hosts.map((h) => h.host).join(", ") || "none"}`,
    `- **Allowed paths:** ${mission.scope.allowed_paths.join(", ") || "none"}`,
    "",
    "## Verified Findings",
    "",
  ]

  for (const f of verified) {
    lines.push(`### ${f.title}`, "")
    lines.push(`**ID:** ${f.id} | **Severity:** ${f.severity} | **CWE:** ${f.cwe ?? "unspecified"}`, "")
    lines.push("**Description:**", "", f.description, "")

    if ((f.evidence?.length ?? 0) > 0) {
      lines.push("**Evidence:**")
      for (const e of f.evidence) {
        lines.push(`- [${e.kind}] ${e.content.slice(0, 500)}`)
      }
      lines.push("")
    }

    if (f.remediation) {
      lines.push("**Remediation:**", "", f.remediation, "")
    }

    if ((f.references?.length ?? 0) > 0) {
      lines.push("**References:**")
      for (const r of f.references) lines.push(`- ${r}`)
      lines.push("")
    }

    const gate = f.verify_gate
    if (gate) {
      lines.push("**Provenance Gate:**")
      lines.push(`- Passed: ${gate.passed}`)
      lines.push(`- Provenance: ${gate.provenance}`)
      if (gate.reasons.length > 0) {
        lines.push(`- Reasons: ${gate.reasons.join("; ")}`)
      }
      lines.push(`- Checked: ${gate.checked_at}`, "")
    }
  }

  lines.push("---", "")
  lines.push("## Honesty Disclaimer")
  lines.push("")
  lines.push("- Every finding above passed the provenance gate (tool-backed evidence).")
  lines.push("- Model-asserted findings without tool output were excluded from this draft.")
  lines.push("- CVSS vectors, if provided, are asserted by the agent and must be independently validated.")
  lines.push("- **This is a draft. A human must review and send it.**")

  return lines.join("\n")
}

export function generateReport(mission: Mission, format: "summary" | "disclosure"): string {
  if (format === "disclosure") return generateDisclosureReport(mission)
  return generateSummaryReport(mission)
}

export function getHighestEvidenceLevel(mission: Mission): string {
  let highest = "claimed"
  let highestScore = 0
  for (const f of mission.findings) {
    const score = EVIDENCE_LEVEL_ORDER[f.evidence_level] ?? 0
    if (score > highestScore) {
      highestScore = score
      highest = f.evidence_level
    }
  }
  return highest
}
