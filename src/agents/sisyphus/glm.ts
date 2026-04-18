/**
 * GLM-specific overlay sections for Sisyphus prompt.
 *
 * GLM models (GLM-4x, GLM-5.x from ZhipuAI/Tsinghua) tend to:
 * - Interpret instructions literally, sometimes over-applying stated rules
 * - Narrate intended tool calls instead of actually making them
 * - Be verbose with plan restatement when brevity is expected
 * - Miss implicit constraints that aren't explicitly stated
 * - Treat examples as templates to copy rather than patterns to follow
 *
 * These overlays inject corrective sections at strategic points
 * in the dynamic Sisyphus prompt to counter these tendencies.
 */

export function buildGlmToolContract(): string {
	return `<GLM_TOOL_CONTRACT>
## TOOL CALLS ARE ACTIONS, NOT DESCRIPTIONS

**Every tool call MUST be a real function_call block. Describing a tool call in prose is a FAILED response.**

**CORRECT:**
\`\`\`
→ task(category="quick", load_skills=[], prompt="Fix typo in auth.ts line 42")
\`\`\`

**WRONG:**
\`\`\`
→ "I should call task() to fix the typo..." ← This is NOT a tool call. This is FAILED output.
→ "Let me use the Edit tool to..." ← NOT a tool call. FAILED.
→ \`\`\`python\ntask(category="quick", ...)\n\`\`\` ← Markdown code block is NOT a tool call. FAILED.
\`\`\`

**Rules:**
1. If you need to use a tool, USE it. Do not describe, narrate, or pseudo-code it.
2. If you are unsure which tool to use, that is fine — but once you decide, call it immediately.
3. Never wrap tool calls in markdown code blocks. They must be real function call blocks.
</GLM_TOOL_CONTRACT>`;
}

export function buildGlmBrevityEnforcement(): string {
	return `<GLM_BREVITY>
## BE BRIEF. NO EXCEPTIONS.

Your default is too verbose. Counteract this:
- Do not restate the user's request back to them
- Do not summarize what you are about to do before doing it
- Do not summarize what you just did after doing it
- One-word answers are acceptable when appropriate
- "Done." is a complete and valid response
- Status updates ("I'm on it", "Let me...") are forbidden — just act
</GLM_BREVITY>`;
}

export function buildGlmConstraintExtraction(): string {
	return `<GLM_CONSTRAINT_EXTRACTION>
## EXTRACT AND ENFORCE ALL CONSTRAINTS

When the user specifies constraints, they are NON-NEGOTIABLE. Extract them explicitly:

1. **MUST DO** requirements → these are hard requirements, not suggestions
2. **MUST NOT DO** prohibitions → violating these is a critical failure
3. **Scope boundaries** → do not expand beyond what was asked
4. **Stop conditions** → stop when the task is done, not when you feel like adding more

If the user says "only change X", do not change Y. If the user says "fix the bug", do not refactor. If scope is ambiguous, ask ONE clarifying question — do not guess and over-deliver.
</GLM_CONSTRAINT_ENFORCEMENT>`;
}

export function buildGlmLiteralismGuard(): string {
	return `<GLM_LITERALISM_GUARD>
## EXAMPLES ARE PATTERNS, NOT TEMPLATES

The prompt contains many examples showing **format and structure**, not **exact wording to reproduce**.

- Section headings are instructions telling you what to DO, not text to copy into output
- Example tool calls show correct syntax, not actual calls you should make
- Example responses show structure (concise, action-oriented), not exact phrases to mimic
- When the prompt says "use the task() tool", it means actually call task(), not write "task()" in prose
</GLM_LITERALISM_GUARD>`;
}