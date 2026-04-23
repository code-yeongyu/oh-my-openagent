import type { BuiltinSkill } from "../types"

const AGENT_AUDIT_OVERVIEW = `# Agent Audit

Audit the **agent system itself**, not the user's domain task.

Use this when the runtime feels worse than the base model, skips tools, leaks stale memory, mutates good answers during formatting, or behaves like a stack of hidden self-sabotage.

This skill is for:

- wrapper regression
- tool-discipline failures
- stale evidence replay
- memory contamination
- hidden repair or retry layers
- rendering or transport mutation

## Core rule

Work evidence-first and JSON-first.

Do not jump straight to prose conclusions.

Before writing the final diagnosis, build these structured artifacts in order:

1. \`agent_check_scope.json\`
2. \`evidence_pack.json\`
3. \`failure_map.json\`
4. \`agent_check_report.json\``

const AGENT_AUDIT_TARGET = `## Audit target

Audit the full stack, not only the current prompt:

1. system prompt and role shaping
2. session history injection
3. long-term memory retrieval
4. summaries or distillation
5. active recall or recap layers
6. tool routing and selection
7. tool execution
8. tool-output interpretation
9. answer shaping
10. platform rendering or transport
11. fallback or repair loops
12. persistence and stale state

## Required working style

- Prefer direct evidence: code, config, logs, payloads, DB rows, screenshots, and tests
- Treat a clean current state as insufficient if the failure was historical
- Prefer code and configuration fixes over prompt-only fixes
- Be explicit about confidence and contradictions
- If the wrapper is the problem, say so directly`

const AGENT_AUDIT_ARTIFACTS = `## Artifact contracts

### \`agent_check_scope.json\`

Define:

- target system
- entrypoints
- channels or surfaces
- model stack
- time window of interest
- symptoms
- layers to audit

### \`evidence_pack.json\`

Capture:

- exact files and code locations
- logs, payloads, DB rows, config files, and screenshots
- whether each item is current, historical, or mixed
- missing evidence that blocks confidence

### \`failure_map.json\`

For each failure mode include:

- severity
- symptom
- user impact
- source layer
- mechanism
- root cause
- evidence refs
- recommended fix

### \`agent_check_report.json\`

Render the final structured report with:

- executive verdict
- severity-ranked findings
- conflict map across layers
- contamination paths
- ordered fix plan`

const AGENT_AUDIT_PLAYBOOKS = `## Standard playbooks

Use one of these as the primary audit mode:

- \`wrapper-regression\`: base model is fine, wrapper is worse
- \`memory-contamination\`: old facts or summaries bleed into current turns
- \`tool-discipline\`: tools should have been used but were skipped or bypassed
- \`rendering-transport\`: answers are degraded during delivery or formatting
- \`hidden-agent-layers\`: retries, repairs, or summaries behave like undocumented agents

Advanced playbooks:

- \`false-confidence\`
- \`stale-evidence-replay\`
- \`fake-agentic-depth\`
- \`hidden-repair-brain\`
- \`memory-poisoning\`
- \`protocol-decay\``

const AGENT_AUDIT_RUBRIC = `## Audit rubric

Inspect these dimensions explicitly:

1. Context cleanliness
2. Tool discipline
3. Failure handling
4. Memory admission
5. Answer shaping
6. Hidden agent layers
7. JSON vs freeform boundary

Severity heuristics:

- \`critical\`: confidently wrong operational behavior
- \`high\`: repeated corruption of otherwise good evidence
- \`medium\`: correctness often survives, but the system is fragile or noisy
- \`low\`: mostly maintainability or cosmetic concerns`

const AGENT_AUDIT_SCHEMA = `## Report schema

Use this shape when building \`agent_check_report.json\`:

\`\`\`json
{
  "schema_version": "agent-audit.report.v1",
  "executive_verdict": {
    "overall_health": "critical | high_risk | unstable | acceptable | strong",
    "primary_failure_mode": "string",
    "most_urgent_fix": "string"
  },
  "findings": [
    {
      "severity": "critical | high | medium | low",
      "title": "string",
      "symptom": "string",
      "source_layer": "string",
      "root_cause": "string",
      "recommended_fix": "string"
    }
  ],
  "conflict_map": [
    {
      "from_layer": "string",
      "to_layer": "string",
      "conflict_type": "duplication | contradiction | stale_state | hidden_mutation | freeform_overwrite",
      "note": "string"
    }
  ],
  "contamination_paths": [
    {
      "origin_layer": "string",
      "affected_layer": "string",
      "artifact": "string",
      "failure_mode": "string",
      "note": "string"
    }
  ],
  "ordered_fix_plan": [
    {
      "order": 1,
      "goal": "string",
      "why_now": "string",
      "expected_effect": "string"
    }
  ]
}
\`\`\``

const AGENT_AUDIT_EXAMPLE = `## Example output

\`\`\`json
{
  "schema_version": "agent-audit.report.v1",
  "executive_verdict": {
    "overall_health": "high_risk",
    "primary_failure_mode": "stale same-session evidence is being reused as if it were current truth",
    "most_urgent_fix": "enforce code-level fresh probes for operational queries"
  },
  "findings": [
    {
      "severity": "critical",
      "title": "Operational answers can bypass real inspection",
      "symptom": "The agent gives confident system-state answers before tools run.",
      "source_layer": "tool_selection",
      "root_cause": "Prompt-enforced discipline instead of code-enforced discipline.",
      "recommended_fix": "Introduce task classification plus mandatory probe execution before final answer generation."
    }
  ],
  "ordered_fix_plan": [
    {
      "order": 1,
      "goal": "Force fresh probes for system-state queries",
      "why_now": "It removes the most damaging correctness failure immediately.",
      "expected_effect": "Wrong operational answers drop sharply."
    }
  ]
}
\`\`\`

## Output rules

- Lead with findings, not compliments
- Do not hide uncertainty
- Do not blame the base model unless wrapper layers have been falsified
- Do not improvise a new theory after producing the report
- Render from the structured report`

export const agentAuditSkill: BuiltinSkill = {
  name: "agent-audit",
  description:
    "Audit agent runtimes with structured evidence, severity-ranked findings, contamination paths, and ordered fix plans. Use for wrapper regression, tool-discipline failures, stale memory contamination, hidden repair layers, or answer mutation during delivery.",
  template: [
    AGENT_AUDIT_OVERVIEW,
    "---",
    AGENT_AUDIT_TARGET,
    "---",
    AGENT_AUDIT_ARTIFACTS,
    "---",
    AGENT_AUDIT_PLAYBOOKS,
    "---",
    AGENT_AUDIT_RUBRIC,
    "---",
    AGENT_AUDIT_SCHEMA,
    "---",
    AGENT_AUDIT_EXAMPLE,
  ].join("\n\n"),
}
