import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import * as skillLoader from "../../features/opencode-skill-loader/skill-content";
import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
import { hashDescription } from "./cache-checker";
import * as cacheStorage from "./cache-storage";
import { createSkillAutoTriggerHook } from "./index";
import * as triggerGenerator from "./trigger-generator";
import type { SkillTriggerCache } from "./types";

describe("skill auto-trigger cache cleanup", () => {
	let getAllSkillsSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		getAllSkillsSpy = spyOn(skillLoader, "getAllSkills").mockResolvedValue([]);
	});

	afterEach(() => {
		getAllSkillsSpy?.mockRestore();
	});

	test("removes deleted skills from cache without fallback", async () => {
		//#given
		const description = "Use when audit logs";
		const hash = hashDescription(description);
		const cache: SkillTriggerCache = {
			version: "1.0",
			generatedAt: "",
			skills: {
				"deleted-skill": {
					hash: "deadbeef",
					triggers: ["old"],
					priority: 1,
					scope: "user",
				},
				"keep-skill": {
					hash,
					triggers: ["audit"],
					priority: 10,
					scope: "user",
				},
			},
		};
		const loadSpy = spyOn(cacheStorage, "loadCache").mockReturnValue(cache);
		const saveSpy = spyOn(cacheStorage, "saveCache").mockImplementation(
			() => {},
		);
		const generateSpy = spyOn(
			triggerGenerator,
			"generateDynamicTriggers",
		).mockResolvedValue([]);
		const skills: LoadedSkill[] = [
			{
				name: "keep-skill",
				scope: "user",
				definition: {
					name: "keep-skill",
					description,
					template: "",
				},
			},
		];
		getAllSkillsSpy.mockResolvedValue(skills);
		const hook = createSkillAutoTriggerHook({} as PluginInput);
		const output = {
			message: {} as Record<string, unknown>,
			parts: [{ type: "text", text: "Please audit the logs" }],
		};

		//#when
		await hook["chat.message"]({ sessionID: "test-session" }, output);

		//#then
		const textPart = output.parts[0];
		expect(textPart.text).toContain("`keep-skill`");
		expect(generateSpy).not.toHaveBeenCalled();
		expect(saveSpy).toHaveBeenCalled();
		const savedCache = saveSpy.mock.calls[0][0] as SkillTriggerCache;
		expect(savedCache.skills["deleted-skill"]).toBeUndefined();

		loadSpy.mockRestore();
		saveSpy.mockRestore();
		generateSpy.mockRestore();
	});
});
