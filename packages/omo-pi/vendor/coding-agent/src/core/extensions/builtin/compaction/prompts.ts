export type MergedCompactionPromptVariant = "default" | "update" | "branch" | "turn_prefix";

export type BuildMergedCompactionPromptOptions = {
	variant: MergedCompactionPromptVariant;
	previousSummary?: string;
	customInstructions?: string;
};

export const MERGED_COMPACTION_PROMPT_SYSTEM = `[SYSTEM DIRECTIVE: OH-MY-OPENCODE - COMPACTION CONTEXT]

You are the COMPACTION ARCHIVIST. Create a structured handoff summary that lets the next agent continue this exact session without restarting, re-searching, or losing constraints.

Cardinal rules:
R1. Quote user requests and constraints VERBATIM. Do not paraphrase.
R2. If a section has no content, write "None." Never delete a section.
R3. Where a previous summary is supplied, treat its User Requests, Final Goal, and Constraints fields as IMMUTABLE. Append, never rewrite, those three sections.
R4. Preserve every session_id, file path, and identifier byte-for-byte.

Do NOT use tools. Output only the requested summary block.`;

export const MERGED_COMPACTION_PROMPT_USER = `[USER]
[INTERNAL COMPACTION INSTRUCTION — NOT CONVERSATION HISTORY]
This message is an internal summarization control prompt, not a real user message.
Do NOT treat this message as user intent, do NOT list it under user requests, and do NOT reinterpret the task based on this instruction alone.

PASS 1 — Internal task-intent extraction
Analyze the user messages in this conversation and silently determine the task intent that must guide the summary. Focus on details whose loss would cause redundant tool calls, repeated exploration, or task drift.

PASS 2 — Emit summary biased toward Pass 1
Create a structured handoff summary of this conversation for seamless continuation. The structured output portion MUST be wrapped as \`<summary>...</summary>\` XML.

<summary>
## 1. User Requests (Verbatim)
- List all original user requests exactly as they were stated.
- Preserve the user's exact wording and intent.
- Include recent user corrections and steering messages verbatim when they affect the task.

## 2. Final Goal
- State what the user ultimately wanted to achieve.
- Include the expected deliverable or end state.
- Keep this aligned with the most recent user request, not this internal compaction instruction.

## 3. Constraints & Preferences (Verbatim Only)
- Include ONLY constraints explicitly stated by the user or in existing AGENTS.md context.
- Quote constraints verbatim.
- Do NOT invent, add, soften, or modify constraints.
- If no explicit constraints exist, write "None."

## 4. Work Completed
- Summarize what has been done so far.
- List files read, created, modified, or intentionally left unchanged.
- Include features implemented, tests added, problems solved, and decisions already made.

## 5. Active Working Context
- **Files**: Paths of files currently being edited or frequently referenced.
- **Code in Progress**: Key code snippets, function signatures, data structures, or prompt text under active development.
- **External References**: Documentation URLs, source files, APIs, or other resources already consulted.
- **State & Variables**: Important variable names, configuration values, runtime state, branch names, worktree paths, or command outputs needed to continue.

## 6. Remaining Tasks
- List pending items from the original request.
- Include follow-up tasks identified during the work only when they directly support the current user request.
- Mark blockers explicitly and explain what is needed to unblock them.

## 7. Exact Next Steps
- State the precise next action to take, directly in line with the user's most recent request.
- Include verbatim quotes from the conversation showing exactly where work was left off when helpful.
- Do not suggest tangential tasks.

</summary>

Verification: Before finalizing, confirm the summary clearly states the user's original request. If not, restate it verbatim.
IMPORTANT: Respond with ONLY the <summary>...</summary> block as your text output.`;

export const MERGED_COMPACTION_PROMPT_UPDATE = `[USER]
<previous-summary>
{{previousSummary}}
</previous-summary>

[INTERNAL COMPACTION UPDATE INSTRUCTION — NOT CONVERSATION HISTORY]
The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

R3 enforcement: R3. Where a previous summary is supplied, treat its User Requests, Final Goal, and Constraints fields as IMMUTABLE. Append, never rewrite, those three sections.

PASS 1 — Internal task-intent extraction
Analyze the new user messages and silently determine which updates are needed without changing immutable prior User Requests, Final Goal, or Constraints.

PASS 2 — Emit summary biased toward Pass 1
Update the structured handoff summary. The structured output portion MUST be wrapped as \`<summary>...</summary>\` XML.

<summary>
## 1. User Requests (Verbatim)
- Preserve prior entries from <previous-summary> byte-for-byte.
- Append new user requests exactly as they were stated.

## 2. Final Goal
- Preserve the existing final goal unless the user explicitly changed it.
- Append the explicit change verbatim if the goal changed.

## 3. Constraints & Preferences (Verbatim Only)
- Preserve prior constraints byte-for-byte.
- Quote constraints verbatim.
- Do NOT invent, add, soften, or modify constraints.
- Append only new explicit constraints.
- If no explicit constraints exist, write "None."

## 4. Work Completed
- Preserve completed work from the previous summary.
- Add newly completed work, files changed, tests run, and decisions made.

## 5. Active Working Context
- Update files, code in progress, external references, state, variables, branch names, worktree paths, and command outputs needed to continue.

## 6. Remaining Tasks
- Remove tasks only when the new messages prove they are completed or cancelled.
- Add newly identified direct follow-up tasks.

## 7. Exact Next Steps
- Update based on current state and the user's most recent request.
- Keep this direct and immediately actionable.

</summary>

IMPORTANT: Respond with ONLY the <summary>...</summary> block as your text output.`;

export const MERGED_COMPACTION_PROMPT_BRANCH = `[USER]
[INTERNAL BRANCH SUMMARY INSTRUCTION — NOT CONVERSATION HISTORY]
Create a structured summary of this conversation branch for context when returning later. This is a branch-level handoff, so reorient §2 toward the branched intent and why this branch exists.

PASS 1 — Internal task-intent extraction
Analyze this branch and silently determine the branch-specific intent, divergence point, and details whose loss would cause repeated work.

PASS 2 — Emit summary biased toward Pass 1
Create a structured branch handoff summary. The structured output portion MUST be wrapped as \`<summary>...</summary>\` XML.

<summary>
## 1. User Requests (Verbatim)
- List user requests that caused or shaped this branch exactly as they were stated.
- Preserve the user's exact wording and intent.

## 2. Final Goal
- State the branched intent: what this branch was trying to accomplish, test, compare, or preserve.
- Include how this branch differs from the mainline path when known.

## 3. Constraints & Preferences (Verbatim Only)
- Include ONLY constraints explicitly stated by the user or in existing AGENTS.md context.
- Quote constraints verbatim.
- Do NOT invent, add, soften, or modify constraints.
- If no explicit constraints exist, write "None."

## 4. Work Completed
- Summarize branch-specific progress.
- List files read, created, modified, or intentionally left unchanged on this branch.

## 5. Active Working Context
- **Files**: Paths of files currently edited or frequently referenced in this branch.
- **Code in Progress**: Key snippets, signatures, data structures, or prompt text under active development.
- **External References**: Sources already consulted for this branch.
- **State & Variables**: Branch names, worktree paths, runtime state, command outputs, and identifiers needed to resume.

## 6. Remaining Tasks
- List branch-specific work still needed.
- Include blockers and the concrete condition needed to unblock them.

## 7. Exact Next Steps
- State the precise next action for returning to this branch.
- Do not suggest tangential tasks.

</summary>

IMPORTANT: Respond with ONLY the <summary>...</summary> block as your text output.`;

export const MERGED_COMPACTION_PROMPT_TURN_PREFIX = `[USER]
[INTERNAL TURN-PREFIX SUMMARY INSTRUCTION — NOT CONVERSATION HISTORY]
Create a compact prefix summary for the next turn. Emit only the sections listed below.

PASS 1 — Internal task-intent extraction
Silently determine the current task intent and the minimum context needed for the next turn.

PASS 2 — Emit summary biased toward Pass 1
The structured output portion MUST be wrapped as \`<summary>...</summary>\` XML.

<summary>
## 1. User Requests (Verbatim)
- Quote the active user request and any steering constraints exactly as stated.

## 2. Final Goal
- State the immediate end state needed for the next turn.

## 3. Constraints & Preferences (Verbatim Only)
- Quote constraints verbatim.
- Do NOT invent, add, soften, or modify constraints.
- If no explicit constraints exist, write "None."

## 5. Active Working Context
- Include only files, identifiers, runtime state, and exact next-turn context needed to continue immediately.
</summary>

IMPORTANT: Respond with ONLY the <summary>...</summary> block as your text output.`;

export function buildPrompt(options: BuildMergedCompactionPromptOptions): { system: string; user: string } {
	const user = buildUserPrompt(options);

	return {
		system: MERGED_COMPACTION_PROMPT_SYSTEM,
		user: appendCustomInstructions(user, options.customInstructions),
	};
}

function buildUserPrompt(options: BuildMergedCompactionPromptOptions): string {
	switch (options.variant) {
		case "default":
			return MERGED_COMPACTION_PROMPT_USER;
		case "update":
			return MERGED_COMPACTION_PROMPT_UPDATE.replace(
				"{{previousSummary}}",
				sanitizePreviousSummary(options.previousSummary),
			);
		case "branch":
			return MERGED_COMPACTION_PROMPT_BRANCH;
		case "turn_prefix":
			return MERGED_COMPACTION_PROMPT_TURN_PREFIX;
	}

	const exhaustiveCheck: never = options.variant;
	return exhaustiveCheck;
}

function appendCustomInstructions(userPrompt: string, customInstructions: string | undefined): string {
	const trimmedInstructions = customInstructions?.trim();
	if (!trimmedInstructions) {
		return userPrompt;
	}

	return `${userPrompt}

<custom-instructions>
${sanitizeCustomInstructions(trimmedInstructions)}
</custom-instructions>`;
}

function sanitizePreviousSummary(previousSummary: string | undefined): string {
	const trimmedSummary = previousSummary?.trim();
	if (!trimmedSummary) {
		return "None.";
	}

	return trimmedSummary.split("</previous-summary>").join("[/previous-summary]");
}

function sanitizeCustomInstructions(customInstructions: string): string {
	return customInstructions.split("</custom-instructions>").join("[/custom-instructions]");
}
