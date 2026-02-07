import { describe, expect, spyOn, test } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import type { CommandDefinition } from "../../features/claude-code-command-loader/types";
import type {
	LoadedSkill,
	SkillScope,
} from "../../features/opencode-skill-loader/types";
import { triggerBackgroundExtraction } from "./ai-extractor";
import * as cacheStorage from "./cache-storage";
import type { SkillTriggerCache } from "./types";

function createSkill(
	name: string,
	options: { description?: string; scope?: SkillScope } = {},
): LoadedSkill {
	const { description, scope = "user" } = options;
	const definition: CommandDefinition = {
		name,
		template: "",
		...(description ? { description } : {}),
	};
	return {
		name,
		scope,
		definition,
	};
}

describe("ai-extractor", () => {
	test("triggerBackgroundExtraction is exported", () => {
		//#given
		//#when
		//#then
		expect(typeof triggerBackgroundExtraction).toBe("function");
	});

	test("triggerBackgroundExtraction adds fallback triggers when AI returns empty", async () => {
		//#given
		const saveSpy = spyOn(cacheStorage, "saveCache").mockImplementation(
			() => {},
		);
		const skills = [
			createSkill("livestream-playbook", {
				description: "Use for livestream ops",
			}),
		];
		const cache: SkillTriggerCache = {
			version: "1.0",
			generatedAt: "",
			skills: {},
		};
		const extractFn = async (
			_ctx: PluginInput,
			_skills: LoadedSkill[],
			_sessionId: string,
		) => ({});

		//#when
		const triggers = await triggerBackgroundExtraction(
			{} as PluginInput,
			skills,
			cache,
			"session-id",
			extractFn,
		);

		//#then
		const match = triggers.find(
			(trigger) => trigger.skillName === "livestream-playbook",
		);
		expect(match).toBeDefined();
		if (!match) {
			throw new Error("Expected livestream-playbook trigger");
		}
		expect(match.keywords.test("直播话术")).toBe(true);

		saveSpy.mockRestore();
	});
});
