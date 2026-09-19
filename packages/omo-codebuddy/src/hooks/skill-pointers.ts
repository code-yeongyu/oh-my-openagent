/**
 * Skill pointers: when a prompt merely MENTIONS an omo workflow skill, inject a
 * hidden pointer telling the model to read that skill — a mention is not a
 * request, so the pointer text stays conditional.
 *
 * Ported from the Senpi adapter's `skill-pointers` component (same keyword
 * table, same conditional wording) with two CodeBuddy-specific changes:
 *  - the invocation channel is `/omo:<skill>` (plugin namespace) rather than
 *    `senpi`'s `load_skills`;
 *  - dedup reads the CodeBuddy transcript's `additionalContext` entries.
 */

/** `ulw` spellings that carry no literal "ulw" are part of the mass alias. */
export const MASS_ALIAS = "mass[\\s-]*ulw|ulw[\\s-]*mass|mulw|meth";

export interface SkillPointerSpec {
	readonly skill: string;
	readonly pattern: RegExp;
	/** Injected alongside the parent whenever the parent fires. */
	readonly companion?: string;
}

export const SKILL_POINTER_SPECS: readonly SkillPointerSpec[] = [
	{ skill: "mass-ulw", pattern: new RegExp(`\\b(?:${MASS_ALIAS})\\b`, "i") },
	{ skill: "ulw-plan", pattern: /\bulw[\s-]*plan\b/i },
	{ skill: "ulw-loop", pattern: /\bulw[\s-]*loop\b/i },
	{
		skill: "ulw-research",
		pattern: new RegExp(`\\b(?:ulw|${MASS_ALIAS})[\\s-]*research\\b`, "i"),
		companion: "ultimate-browsing",
	},
];

/**
 * `ulw` arms ultrawork mode on its own, but NOT when it is only the prefix of a
 * workflow name (`ulw-plan`, `ulw-research`, `ulw-loop`, `ulw-execute`): those
 * mentions get their own pointer and must not drag the full ultrawork directive
 * into the turn.
 */
export const ULTRAWORK_TRIGGER_PATTERN = /\b(?:ultrawork|ulw(?![\s-]*(?:plan|research|loop|execute))\b)/i;

/**
 * Blank out regions where a mention is being QUOTED rather than requested:
 * fenced code, inline code, and previously injected omo blocks. Offsets are
 * preserved so callers may map matches back onto the original text.
 */
export function stripQuotedRegions(input: string): string {
	const blank = (match: string): string => " ".repeat(match.length);
	return input
		.replace(/```[\s\S]*?```/g, blank)
		.replace(/~~~[\s\S]*?~~~/g, blank)
		.replace(/`[^`\n]*`/g, blank)
		.replace(/<(?:omo|ultrawork)[^>]*>[\s\S]*?<\/(?:omo|ultrawork)[^>]*>/gi, blank);
}

export function matchesUltrawork(input: string): boolean {
	return ULTRAWORK_TRIGGER_PATTERN.test(stripQuotedRegions(input));
}

export function matchSkillPointers(input: string): string[] {
	const scannable = stripQuotedRegions(input);
	const matched: string[] = [];
	for (const spec of SKILL_POINTER_SPECS) {
		if (!spec.pattern.test(scannable)) continue;
		if (!matched.includes(spec.skill)) matched.push(spec.skill);
		if (spec.companion !== undefined && !matched.includes(spec.companion)) matched.push(spec.companion);
	}
	return matched;
}

/** True when the input already invokes the skill directly, so no pointer is needed. */
export function inputInvokesSkill(input: string, skill: string): boolean {
	const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const commandPattern = new RegExp(`(?:^|\\s)/omo:${escaped}(?:\\s|$)`);
	const expandedPattern = new RegExp(`<skill[^>]*name=["']${escaped}["']`, "i");
	return commandPattern.test(input) || expandedPattern.test(input);
}

export interface SkillPointerContext {
	/** Absolute path of the skill's SKILL.md inside the installed plugin. */
	readonly skillPath: string;
	readonly companionPath?: string;
}

export function buildSkillPointer(skill: string, context: SkillPointerContext): string {
	const lines = [
		`<omo-skill-pointer skill="${skill}">`,
		`This message mentions \`${skill}\`. If the user of this session is asking to run ${skill}, read the skill at:`,
		context.skillPath,
		"",
		`Read the whole file and follow it exactly for that request. ${skill} is a bundled skill of the omo CodeBuddy plugin; it can also be invoked as \`/omo:${skill}\`.`,
		"If the skill file is missing, say the omo skill bundle is incomplete and continue with those same instructions from memory.",
		`If ${skill} is only being discussed, quoted, or relayed from another session, ignore this pointer.`,
	];
	if (context.companionPath !== undefined) {
		lines.push(
			"",
			"This workflow runs its browsing lanes on the bundled `ultimate-browsing` skill; read it in the same turn as the parent skill and use it for every browsing lane:",
			context.companionPath,
		);
	}
	lines.push("</omo-skill-pointer>");
	return lines.join("\n");
}

export function buildUltraworkPointer(skillPath: string): string {
	return [
		"<ultrawork-mode>",
		"ULTRAWORK MODE IS ACTIVE FOR THIS TASK.",
		"",
		"MANDATORY BOOTSTRAP: do all three steps, in order, before anything else.",
		"",
		"1. The first user-visible line this turn MUST be exactly:",
		"`ULTRAWORK MODE ENABLED!`",
		"",
		"2. Record the objective before any other tool call: if your harness exposes a goal/todo",
		"   tool, create the goal with the user's request verbatim; otherwise open your reply with a",
		"   binding `# Goal` block. Never skip this step.",
		"",
		"3. Read the FULL ultrawork directive NOW, before any other tool call, plan, or edit.",
		"   It is the `ultrawork` skill of this plugin, stored at:",
		"",
		skillPath,
		"",
		"   Read the whole file (use Read with the path above when the skill view is not enough).",
		"   If a read comes back truncated, keep reading the remaining ranges until every line is",
		"   seen. Every rule in that file is binding for this entire task: no compromise, no",
		"   summarizing from memory, no skipping. If the file does not exist, tell the user the omo",
		"   ultrawork skill is missing and continue with steps 1 and 2 plus evidence-bound execution.",
		"",
		"Do not start the requested work until all three steps are complete.",
		"</ultrawork-mode>",
	].join("\n");
}
