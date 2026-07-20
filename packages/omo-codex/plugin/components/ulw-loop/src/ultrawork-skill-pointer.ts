import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ULTRAWORK_SKILL_POINTER_TEMPLATE = `<ultrawork-mode>
ULTRAWORK MODE IS ACTIVE FOR THIS TASK.

MANDATORY BOOTSTRAP: do all three steps, in order, before anything else.

1. First user-visible line this turn MUST be exactly:
\`ULTRAWORK MODE ENABLED!\`

2. Call \`create_goal\` NOW with \`objective\` set to the user's request.
Send \`objective\` only: no \`status\`, no budget fields. If the
\`create_goal\` tool is unavailable, open your reply with a binding
\`# Goal\` block instead. Never skip this step.

3. Read the FULL ultrawork directive NOW, before any other tool call,
plan, or edit. It is the \`ultrawork\` skill, stored at:

{{ULTRAWORK_SKILL_PATH}}

Read the whole file. If a read result comes back truncated, keep
reading the remaining line ranges until you have seen every line.
Every rule in that file is binding for this entire task: no
compromise, no summarizing from memory, no skipping. If the file does
not exist, tell the user the omo ultrawork skill is missing and
continue with steps 1 and 2 plus evidence-bound execution.

Do not start the requested work until all three steps are complete.
</ultrawork-mode>
`;

const ULTRAWORK_SKILL_PATH_PLACEHOLDER = "{{ULTRAWORK_SKILL_PATH}}";
const ULTRAWORK_SKILL_FILE_URL = new URL("../../../skills/ultrawork/SKILL.md", import.meta.url);
const ULTRAWORK_DIRECTIVE = readFileSync(new URL("../directive.md", import.meta.url), "utf8");

export interface UltraworkAdditionalContextOptions {
	readonly skillFilePath?: string | null;
}

export function resolveUltraworkSkillFilePath(): string {
	return fileURLToPath(ULTRAWORK_SKILL_FILE_URL);
}

export function buildUltraworkSkillPointer(skillFilePath: string): string {
	return ULTRAWORK_SKILL_POINTER_TEMPLATE.replace(ULTRAWORK_SKILL_PATH_PLACEHOLDER, skillFilePath);
}

export function buildUltraworkAdditionalContext(options: UltraworkAdditionalContextOptions = {}): string {
	const skillFilePath = options.skillFilePath === undefined ? resolveUltraworkSkillFilePath() : options.skillFilePath;
	if (skillFilePath !== null && existsSync(skillFilePath)) {
		return buildUltraworkSkillPointer(skillFilePath);
	}
	return ULTRAWORK_DIRECTIVE;
}
