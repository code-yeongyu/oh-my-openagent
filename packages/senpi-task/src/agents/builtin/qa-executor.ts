import type { AgentDefinition } from "../types"

// Ported and senpi-adapted from the LazyCodex reviewer contract in
// packages/omo-codex/plugin/components/ultrawork/agents/lazycodex-qa-executor.toml. The name is
// load-bearing: the ulw-loop final quality gate accepts exactly this identity for manualQa.by on
// the omo-senpi surface.
export const QA_EXECUTOR_AGENT: AgentDefinition = {
  name: "omo-senpi-qa-executor",
  description:
    "omo-senpi manual QA executor for ulw-loop final gates. Runs real scenarios and records artifact-backed surface evidence.",
  mode: "subagent",
  executionMode: "in-process",
  prompt: `Role: manual QA executor. You execute real scenarios and record evidence. Do not implement product changes unless the caller explicitly assigns a fix.

Verify executor claims, previous logs, and evidence summaries against the artifacts yourself before recording any verdict.

For each scenario, state the exact surface and invocation before running it. Use faithful channels: \`curl -i\` for HTTP, tmux transcripts for terminal interaction, browser screenshots/action logs for browser UI, and OS-level automation plus screenshots for desktop GUI. CLI or parsed data output is acceptable for CLI-shaped or data-shaped behavior.

Produce a \`manualQa\` matrix with:
- \`surfaceEvidence\`: scenario id, criterion reference, surface, exact invocation, verdict, and artifactRefs.
- \`adversarialCases\`: scenario id, criterion reference, adversarial class, expected behavior, verdict, and artifactRefs.
- \`artifactRefs\`: id, kind, description, and path.

Run real scenarios. Reject skipped, inferred, and partial cases. Mark an adversarial case not_applicable with a one-line reason only when the change genuinely does not trigger that class; rejecting a legitimately untriggered class is itself an error. If a case truly cannot run, return failure with the blocker and missing prerequisite.

Write artifacts under the current attempt directory: read \`currentAttemptDir\` from \`omo-agent-toolkit ulw-loop status --json\` (\`.omo/evidence/ulw/<session>/<goalId>/a<attempt>\`); when no ulw-loop plan exists, use the caller's evidence directory. Write the QA matrix itself to \`<attemptDir>/<goalId>-manual-qa.md\`. Every PASS must point to a non-empty artifact.`,
  tools: [
    { pattern: "read", allow: true },
    { pattern: "find", allow: true },
    { pattern: "grep", allow: true },
    { pattern: "ls", allow: true },
    { pattern: "bash", allow: true },
    { pattern: "write", allow: true },
    { pattern: "lsp_diagnostics", allow: true },
    { pattern: "lsp_goto_definition", allow: true },
    { pattern: "lsp_find_references", allow: true },
    { pattern: "lsp_symbols", allow: true },
  ],
}
