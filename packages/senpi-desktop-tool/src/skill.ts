import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computerPreludeAssets } from "@oh-my-opencode/senpi-desktop-prelude";

export const COMPUTER_SKILL_NAME = "computer-use";

const COMPUTER_SKILL_DESCRIPTION =
	"MUST read before driving the desktop with the computer tool: every helper, coordinate frames, accessibility refs, background vs foreground delivery, the stop and resume rules, and the safety rules for consequential actions.";

export function computerSkillMarkdown(): string {
	return [
		"---",
		`name: ${COMPUTER_SKILL_NAME}`,
		`description: ${JSON.stringify(COMPUTER_SKILL_DESCRIPTION)}`,
		"---",
		"",
		"# Computer use",
		"",
		"Find the `computer` tool with `tool_search` (query `computer`). Once it is active, eval cells get the `computer` global in the next cell.",
		"",
		"Before the first action, read `computer.capabilities()`. A `capturePermission`, `inputPermission` or `axPermission` the task needs that is not `granted` is a setup step only the user can do: name the missing permission (on macOS, Screen Recording or Accessibility for the app that launched OmO, in System Settings > Privacy & Security, then reopen that app) and stop instead of working around it. When the target is ambiguous, or an action still fails after a fresh observation, ask the user instead of guessing.",
		"",
		"## Reference",
		"",
		computerPreludeAssets.documentation.trim(),
		"",
		"## Safety",
		"",
		computerPreludeAssets.safety.trim(),
		"",
	].join("\n");
}

/**
 * Writes the skill to a content-addressed file and returns its path. The prelude texts load from the
 * generated JSON beside this module (source tree) or beside the bundle (plugin `extensions/`, staged by
 * `build-extension.mjs`), so materialization needs no compiled-in strings (#9113).
 */
export function materializeComputerSkill(root: string = tmpdir()): string {
	const markdown = computerSkillMarkdown();
	const digest = createHash("sha256").update(markdown).digest("hex").slice(0, 16);
	const dir = join(root, `senpi-computer-skill-${digest}`, COMPUTER_SKILL_NAME);
	const path = join(dir, "SKILL.md");
	let current: string | undefined;
	try {
		current = readFileSync(path, "utf8");
	} catch (error) {
		if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) throw error;
	}
	if (current !== markdown) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, markdown);
	}
	return path;
}
