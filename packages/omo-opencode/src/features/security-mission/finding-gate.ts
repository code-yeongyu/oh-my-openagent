import type { Evidence, Provenance, VerifyGate } from "./types"

const TOOL_EVIDENCE_KINDS = new Set([
  "output",
  "command",
  "response",
  "request",
  "log",
  "file",
])

const SEVERITY_REQUIRES_TOOL: Record<string, boolean> = {
  info: false,
  low: false,
  medium: true,
  high: true,
  critical: true,
}

export function classifyProvenance(evidence: Evidence[]): Provenance {
  if (evidence.length === 0) return "none"
  const hasToolEvidence = evidence.some((e) =>
    TOOL_EVIDENCE_KINDS.has(e.kind.toLowerCase()),
  )
  return hasToolEvidence ? "tool" : "context"
}

export function gateFinding(args: {
  readonly severity: string
  readonly evidence: Evidence[]
  readonly now: () => string
}): VerifyGate {
  const { severity, evidence, now } = args
  const provenance = classifyProvenance(evidence)
  const reasons: string[] = []

  if (evidence.length === 0) {
    reasons.push("no evidence provided")
  }

  if (provenance === "context") {
    reasons.push("evidence is contextual only, not backed by tool output")
  }

  const requiresTool = SEVERITY_REQUIRES_TOOL[severity] ?? false
  if (requiresTool && provenance !== "tool") {
    reasons.push(`severity ${severity} requires tool-backed evidence`)
  }

  const passed = reasons.length === 0 && provenance === "tool"

  return {
    passed,
    provenance,
    reasons,
    checked_at: now(),
  }
}
