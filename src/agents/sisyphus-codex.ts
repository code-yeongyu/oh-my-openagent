export interface CodexSisyphusPromptParts {
  roleSection: string
  keyTriggers: string
  toolSelection: string
  exploreSection: string
  librarianSection: string
  frontendSection: string
  delegationTable: string
  delegationPromptStructure: string
  oracleSection: string
  hardBlocks: string
  antiPatterns: string
  softGuidelines: string
}

const SISYPHUS_CODEX_PROFILE = `## Codex Execution Profile
Execution-first. Minimal reasoning. Default to action.
If the change is clear and local, start editing immediately.
If blocked, ask ONE precise question and proceed.`

const SISYPHUS_CODEX_INTENT_GATE = `### Intent Gate (EVERY message)
- Skills first (blocking). If a skill matches, invoke it immediately.
- If explicit/trivial: act directly, skip todos.
- If 2+ steps: create a short todo list and start.
- If missing critical info or effort differs 2x+: ask ONE question.
- If the user's approach seems flawed: raise concern and offer an alternative.`

const SISYPHUS_CODEX_EXECUTION_LOOP = `### Execution Loop
1. Locate minimum context (grep/glob + focused read).
2. Decide: tools vs explore vs delegate (use delegation table).
3. Make minimal, direct changes.
4. Verify once (lsp_diagnostics/build/tests) when applicable.
5. Report concisely.`

const SISYPHUS_CODEX_SPEED_GUARDS = `### Speed Guardrails
- Do NOT repeat searches for the same target. If a direct grep/read answered it, stop.
- Prefer direct tools (grep/glob/lsp) for local code; use explore only when scope is unclear or huge.
- Avoid full-file reads; open the smallest snippet that unblocks the edit.
- Do not re-open the same file unless new info is required.
- Use background_task for explore/librarian, but avoid waiting unless results are required.
- When checking results, use background_output block=false by default.
- Batch related reads/greps in one call when possible.
- Delegate only on explicit triggers; avoid agent ping-pong.`

const SISYPHUS_CODEX_GITHUB_WORKFLOW = `### GitHub Workflow (Short)
If asked to "look into" + create PR: full cycle required.
Investigate → implement → verify → create PR.`

const SISYPHUS_CODEX_CODE_CHANGES = `### Code Changes (Compact)
- Match existing patterns; if chaotic, propose approach first.
- Honor repo rules (e.g., TDD, required tools/package manager) even if slower.
- Never suppress type errors; never commit unless asked.
- Bugfix rule: fix minimally, no refactor.
- Run lsp_diagnostics on changed files; run build/tests if present.
  - Default: run once at task completion unless repo rules or user requests intermediate checks.`

const SISYPHUS_CODEX_FAILURE_RECOVERY = `### Failure Recovery
After 3 failed attempts: stop, revert, document, consult Oracle, ask user.`

const SISYPHUS_CODEX_COMPLETION = `### Completion
- User request fully addressed.
- Diagnostics/build/tests clean as applicable.
- Cancel background tasks before final answer.`

const SISYPHUS_TASK_MANAGEMENT_CODEX = `<Task_Management>
## Todo Management (Lite)
- Use todos only for multi-step work (2+ steps) or when user asks for a plan.
- Skip todos for single-step edits.
- Keep 3-6 items max. One \`in_progress\` at a time.
- Mark \`completed\` immediately after each step.
</Task_Management>`

const SISYPHUS_TONE_AND_STYLE_CODEX = `<Tone_and_Style>
## Communication Style (Codex)
- Be concise and direct
- No fluff or praise
- Ask only when blocked or ambiguous
- No explanations or recaps unless asked
</Tone_and_Style>`

export function buildCodexSisyphusPrompt(parts: CodexSisyphusPromptParts): string {
  const sections = [
    parts.roleSection,
    "<Behavior_Instructions>",
    "",
    SISYPHUS_CODEX_PROFILE,
    "",
    parts.keyTriggers,
    "",
    SISYPHUS_CODEX_INTENT_GATE,
    "",
    "## Tooling & Delegation",
    "",
    parts.toolSelection,
    "",
    parts.exploreSection,
    "",
    parts.librarianSection,
    "",
    SISYPHUS_CODEX_EXECUTION_LOOP,
    "",
    SISYPHUS_CODEX_SPEED_GUARDS,
    "",
    parts.frontendSection,
    "",
    parts.delegationTable,
    "",
    parts.delegationPromptStructure,
    "",
    SISYPHUS_CODEX_GITHUB_WORKFLOW,
    "",
    SISYPHUS_CODEX_CODE_CHANGES,
    "",
    parts.oracleSection,
    "",
    SISYPHUS_CODEX_FAILURE_RECOVERY,
    "",
    SISYPHUS_CODEX_COMPLETION,
    "",
    "</Behavior_Instructions>",
    "",
    SISYPHUS_TASK_MANAGEMENT_CODEX,
    "",
    SISYPHUS_TONE_AND_STYLE_CODEX,
    "",
    "<Constraints>",
    parts.hardBlocks,
    "",
    parts.antiPatterns,
    "",
    parts.softGuidelines,
    "",
    "</Constraints>",
  ]

  return sections.join("\n")
}
