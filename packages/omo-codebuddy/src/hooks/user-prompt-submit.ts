import { additionalContextOutput } from "../protocol/index.ts";
import { pluginSkillPath, skillFileExists } from "./paths.ts";
import {
	buildSkillPointer,
	buildUltraworkPointer,
	inputInvokesSkill,
	matchesUltrawork,
	matchSkillPointers,
} from "./skill-pointers.ts";
import { readTranscriptTail, textShowsContextPressure } from "./transcript.ts";

/**
 * UserPromptSubmit — the two context injectors of the omo CodeBuddy plugin:
 *
 * 1. **ultrawork mode**: a prompt containing `ultrawork` / `ulw` (word-bounded,
 *    quoted regions excluded) arms the binding directive pointer.
 * 2. **skill pointers**: a prompt that merely MENTIONS an omo workflow skill
 *    gets a conditional pointer telling the model to read that skill **if** the
 *    user is actually asking for it.
 *
 * Both are deduplicated against the transcript so a long session injects each
 * block once, and both bail out under context pressure.
 */
export interface UserPromptSubmitOptions {
	readonly pluginRoot: string;
	readonly env?: Record<string, string | undefined>;
}

export function runUserPromptSubmitHook(
	payload: Record<string, unknown>,
	options: UserPromptSubmitOptions,
): string {
	if (payload["hook_event_name"] !== "UserPromptSubmit") return "";
	const prompt = payload["prompt"];
	if (typeof prompt !== "string" || prompt.trim().length === 0) return "";

	const transcriptPath = typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : null;
	if (textShowsContextPressure(prompt)) return "";

	// Transcripts are JSONL, so an injected tag appears with escaped quotes;
	// unescape before matching markers.
	const transcriptTail = readTranscriptTail(transcriptPath).replace(/\\"/g, '"').replace(/\\n/g, "\n");
	if (transcriptTail.length > 0 && textShowsContextPressure(transcriptTail)) return "";

	const blocks: string[] = [];

	if (matchesUltrawork(prompt) && !transcriptTail.includes("<ultrawork-mode>")) {
		const ultraworkSkill = pluginSkillPath(options.pluginRoot, "ultrawork");
		if (skillFileExists(ultraworkSkill)) blocks.push(buildUltraworkPointer(ultraworkSkill));
	}

	for (const skill of matchSkillPointers(prompt)) {
		if (inputInvokesSkill(prompt, skill)) continue;
		if (transcriptTail.includes(`<omo-skill-pointer skill="${skill}">`)) continue;

		const skillPath = pluginSkillPath(options.pluginRoot, skill);
		if (!skillFileExists(skillPath)) continue;

		const companionPath = pluginSkillPath(options.pluginRoot, "ultimate-browsing");
		blocks.push(
			buildSkillPointer(skill, {
				skillPath,
				...(skill === "ulw-research" && skillFileExists(companionPath) ? { companionPath } : {}),
			}),
		);
	}

	if (blocks.length === 0) return "";
	return additionalContextOutput("UserPromptSubmit", blocks.join("\n\n"));
}
