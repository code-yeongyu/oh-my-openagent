/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import type { CommandDefinition } from "../../features/claude-code-command-loader/types";
import * as skillLoader from "../../features/opencode-skill-loader/skill-content";
import type {
	LoadedSkill,
	SkillScope,
} from "../../features/opencode-skill-loader/types";
import { checkForUpdates, hashDescription } from "./cache-checker";
import {
	buildTriggerRegex,
	createSkillAutoTriggerHook,
	extractKeywordsFromDescription,
	findMatchingTriggers,
} from "./index";
import {
	batchSkills,
	buildCachedTriggers,
	buildExtractionPrompt,
	parseAIResponse,
} from "./trigger-extractor";
import {
	EMPTY_CACHE,
	type SkillTrigger,
	type SkillTriggerCache,
} from "./types";

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

function expectRegex(value: RegExp | null, label: string): RegExp {
	expect(value).toBeInstanceOf(RegExp);
	if (!value) {
		throw new Error(`Expected ${label} regex to be defined`);
	}
	return value;
}

describe("extractKeywordsFromDescription", () => {
	test("returns null for empty description", () => {
		//#given
		const description = "";

		//#when
		const regex = extractKeywordsFromDescription(description);

		//#then
		expect(regex).toBeNull();
	});

	test("extracts keywords and returns a RegExp", () => {
		//#given
		const description = "(opencode - Skill) Use when debugging errors";

		//#when
		const regex = expectRegex(
			extractKeywordsFromDescription(description),
			"keyword",
		);

		//#then
		expect(regex.test("Debugging errors happened")).toBe(true);
		expect(regex.test("No match here")).toBe(false);
	});

	test("matches CJK keywords without word boundaries", () => {
		//#given
		const description = "调试 错误 修复";

		//#when
		const regex = expectRegex(
			extractKeywordsFromDescription(description),
			"CJK keyword",
		);

		//#then
		expect(regex.test("请帮我调试一下")).toBe(true);
	});
});

describe("buildTriggerRegex", () => {
	test("matches CJK triggers inside text", () => {
		//#given
		const regex = expectRegex(buildTriggerRegex(["调试"]), "trigger");

		//#when
		const matches = regex.test("需要调试功能");

		//#then
		expect(matches).toBe(true);
	});
});

describe("findMatchingTriggers", () => {
	test("filters triggers by keyword match", () => {
		//#given
		const triggers: SkillTrigger[] = [
			{
				skillName: "debug-skill",
				description: "Use when debugging errors",
				keywords: expectRegex(
					extractKeywordsFromDescription("Use when debugging errors"),
					"debug-skill",
				),
				priority: 10,
				scope: "user",
			},
			{
				skillName: "lint-skill",
				description: "Use when linting",
				keywords: expectRegex(
					extractKeywordsFromDescription("Use when linting"),
					"lint-skill",
				),
				priority: 5,
				scope: "user",
			},
		];

		//#when
		const matches = findMatchingTriggers("debugging errors occurred", triggers);

		//#then
		expect(matches).toHaveLength(1);
		expect(matches[0].skillName).toBe("debug-skill");
	});

	test("returns empty array for empty text", () => {
		//#given
		const triggers: SkillTrigger[] = [
			{
				skillName: "debug-skill",
				description: "Use when debugging errors",
				keywords: expectRegex(
					extractKeywordsFromDescription("Use when debugging errors"),
					"debug-skill",
				),
				priority: 10,
				scope: "user",
			},
		];

		//#when
		const matches = findMatchingTriggers("", triggers);

		//#then
		expect(matches).toHaveLength(0);
	});
});

describe("createSkillAutoTriggerHook", () => {
	let getAllSkillsSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		const skills: LoadedSkill[] = [
			{
				name: "builtin-audit",
				scope: "builtin",
				definition: {
					name: "builtin-audit",
					description: "Use when audit security issues",
					template: "",
				},
			},
			{
				name: "user-audit",
				scope: "user",
				definition: {
					name: "user-audit",
					description: "Use when audit performance metrics",
					template: "",
				},
			},
		];
		getAllSkillsSpy = spyOn(skillLoader, "getAllSkills").mockResolvedValue(
			skills,
		);
	});

	afterEach(() => {
		getAllSkillsSpy?.mockRestore();
	});

	test("injects top matching skill suggestion into output parts", async () => {
		//#given
		const hook = createSkillAutoTriggerHook({} as PluginInput);
		const output = {
			message: {} as Record<string, unknown>,
			parts: [{ type: "text", text: "Please audit the system" }],
		};

		//#when
		await hook["chat.message"]({ sessionID: "test-session" }, output);

		//#then
		const textPart = output.parts[0];
		expect(textPart.text).toContain("[skill-available]");
		expect(textPart.text).toContain("`builtin-audit`");
		expect(textPart.text).toContain('skill("builtin-audit")');
		expect(textPart.text).toContain("Please audit the system");
	});
});

describe("hashDescription", () => {
	test("returns consistent hash for same input", () => {
		//#given
		const description = "test description";

		//#when
		const hash1 = hashDescription(description);
		const hash2 = hashDescription(description);

		//#then
		expect(hash1).toBe(hash2);
	});

	test("returns different hash for different input", () => {
		//#given
		const desc1 = "description one";
		const desc2 = "description two";

		//#when
		const hash1 = hashDescription(desc1);
		const hash2 = hashDescription(desc2);

		//#then
		expect(hash1).not.toBe(hash2);
	});

	test("returns string hash", () => {
		//#given
		const description = "any description";

		//#when
		const hash = hashDescription(description);

		//#then
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThan(0);
	});
});

describe("checkForUpdates", () => {
	test("detects new skills", () => {
		//#given
		const cache: SkillTriggerCache = { ...EMPTY_CACHE };
		const skills = [createSkill("new-skill", { description: "New skill" })];

		//#when
		const result = checkForUpdates(cache, skills);

		//#then
		expect(result.newSkills).toHaveLength(1);
		expect(result.hasUpdates).toBe(true);
	});

	test("detects changed skills", () => {
		//#given
		const cache: SkillTriggerCache = {
			version: "1.0",
			generatedAt: "",
			skills: {
				"test-skill": {
					hash: "oldhash",
					triggers: ["test"],
					priority: 10,
					scope: "user",
				},
			},
		};
		const skills = [
			createSkill("test-skill", { description: "Changed description" }),
		];

		//#when
		const result = checkForUpdates(cache, skills);

		//#then
		expect(result.changedSkills).toHaveLength(1);
		expect(result.hasUpdates).toBe(true);
	});

	test("returns no updates when cache matches", () => {
		//#given
		const description = "Same description";
		const hash = hashDescription(description);
		const cache: SkillTriggerCache = {
			version: "1.0",
			generatedAt: "",
			skills: {
				"test-skill": { hash, triggers: ["test"], priority: 10, scope: "user" },
			},
		};
		const skills = [createSkill("test-skill", { description })];

		//#when
		const result = checkForUpdates(cache, skills);

		//#then
		expect(result.hasUpdates).toBe(false);
	});

	test("detects deleted skills", () => {
		//#given
		const cache: SkillTriggerCache = {
			version: "1.0",
			generatedAt: "",
			skills: {
				"deleted-skill": {
					hash: "somehash",
					triggers: ["delete"],
					priority: 10,
					scope: "user",
				},
			},
		};
		const skills: LoadedSkill[] = [];

		//#when
		const result = checkForUpdates(cache, skills);

		//#then
		expect(result.deletedSkills).toHaveLength(1);
		expect(result.deletedSkills[0]).toBe("deleted-skill");
		expect(result.hasUpdates).toBe(true);
	});

	test("skips skills without description", () => {
		//#given
		const cache: SkillTriggerCache = { ...EMPTY_CACHE };
		const skills = [createSkill("no-desc-skill")];

		//#when
		const result = checkForUpdates(cache, skills);

		//#then
		expect(result.newSkills).toHaveLength(0);
		expect(result.hasUpdates).toBe(false);
	});
});

describe("parseAIResponse", () => {
	test("parses valid JSON response", () => {
		//#given
		const response = '{"skill-a": ["debug", "error"], "skill-b": ["test"]}';

		//#when
		const result = parseAIResponse(response);

		//#then
		expect(result["skill-a"]).toEqual(["debug", "error"]);
		expect(result["skill-b"]).toEqual(["test"]);
	});

	test("extracts JSON from markdown code block", () => {
		//#given
		const response = '```json\n{"skill-a": ["debug"]}\n```';

		//#when
		const result = parseAIResponse(response);

		//#then
		expect(result["skill-a"]).toEqual(["debug"]);
	});

	test("returns empty object for invalid JSON", () => {
		//#given
		const response = "not json at all";

		//#when
		const result = parseAIResponse(response);

		//#then
		expect(result).toEqual({});
	});

	test("handles JSON with surrounding text", () => {
		//#given
		const response =
			'Here is the result: {"skill-x": ["keyword"]} hope it helps!';

		//#when
		const result = parseAIResponse(response);

		//#then
		expect(result["skill-x"]).toEqual(["keyword"]);
	});

	test("filters out non-array values", () => {
		//#given
		const response =
			'{"valid": ["a", "b"], "invalid": "string", "also-invalid": 123}';

		//#when
		const result = parseAIResponse(response);

		//#then
		expect(result.valid).toEqual(["a", "b"]);
		expect(result.invalid).toBeUndefined();
		expect(result["also-invalid"]).toBeUndefined();
	});
});

describe("batchSkills", () => {
	test("batches skills into groups of 15", () => {
		//#given
		const skills = Array.from({ length: 32 }, (_, i) =>
			createSkill(`skill-${i}`),
		);

		//#when
		const batches = batchSkills(skills);

		//#then
		expect(batches).toHaveLength(3);
		expect(batches[0]).toHaveLength(15);
		expect(batches[1]).toHaveLength(15);
		expect(batches[2]).toHaveLength(2);
	});

	test("returns single batch for small skill count", () => {
		//#given
		const skills = Array.from({ length: 5 }, (_, i) =>
			createSkill(`skill-${i}`),
		);

		//#when
		const batches = batchSkills(skills);

		//#then
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(5);
	});

	test("returns empty array for empty input", () => {
		//#given
		const skills: LoadedSkill[] = [];

		//#when
		const batches = batchSkills(skills);

		//#then
		expect(batches).toHaveLength(0);
	});

	test("handles exactly 15 skills", () => {
		//#given
		const skills = Array.from({ length: 15 }, (_, i) =>
			createSkill(`skill-${i}`),
		);

		//#when
		const batches = batchSkills(skills);

		//#then
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(15);
	});
});

describe("buildExtractionPrompt", () => {
	test("builds prompt with skill list", () => {
		//#given
		const skills = [
			createSkill("debug-skill", { description: "Use for debugging" }),
			createSkill("test-skill", { description: "Use for testing" }),
		];

		//#when
		const prompt = buildExtractionPrompt(skills);

		//#then
		expect(prompt).toContain("debug-skill");
		expect(prompt).toContain("test-skill");
		expect(prompt).toContain("Use for debugging");
		expect(prompt).toContain("Use for testing");
		expect(prompt).toContain("Extract trigger keywords");
		expect(prompt).toContain("Simplified Chinese");
	});

	test("truncates long descriptions to 200 chars", () => {
		//#given
		const longDesc = "x".repeat(300);
		const skills = [createSkill("long-skill", { description: longDesc })];

		//#when
		const prompt = buildExtractionPrompt(skills);

		//#then
		expect(prompt).not.toContain("x".repeat(300));
		expect(prompt).toContain("x".repeat(200));
	});

	test("handles skills without description", () => {
		//#given
		const skills = [createSkill("no-desc")];

		//#when
		const prompt = buildExtractionPrompt(skills);

		//#then
		expect(prompt).toContain("no-desc");
	});
});

describe("buildCachedTriggers", () => {
	test("builds cached triggers from skills and extracted data", () => {
		//#given
		const skills = [
			createSkill("skill-a", {
				description: "Skill A description",
				scope: "user",
			}),
			createSkill("skill-b", {
				description: "Skill B description",
				scope: "builtin",
			}),
		];
		const extractedTriggers = {
			"skill-a": ["debug", "error"],
			"skill-b": ["build", "compile"],
		};

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(result["skill-a"]).toBeDefined();
		expect(result["skill-a"].triggers).toEqual(["debug", "error"]);
		expect(result["skill-a"].scope).toBe("user");
		expect(result["skill-b"]).toBeDefined();
		expect(result["skill-b"].triggers).toEqual(["build", "compile"]);
		expect(result["skill-b"].scope).toBe("builtin");
	});

	test("adds fallback triggers when no CJK keywords present", () => {
		//#given
		const skills = [
			createSkill("systematic-debugging", {
				description: "Use when debugging",
				scope: "builtin",
			}),
		];
		const extractedTriggers = { "systematic-debugging": ["debug", "error"] };

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(result["systematic-debugging"]).toBeDefined();
		expect(result["systematic-debugging"].triggers).toContain("调试");
	});

	test("appends fallbacks when CJK present but fallback missing", () => {
		//#given
		const skills = [
			createSkill("systematic-debugging", {
				description: "Use when debugging",
				scope: "builtin",
			}),
		];
		const extractedTriggers = { "systematic-debugging": ["错误"] };

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(result["systematic-debugging"].triggers).toContain("调试");
	});

	test("does not duplicate fallback triggers when already present", () => {
		//#given
		const skills = [
			createSkill("systematic-debugging", {
				description: "Use when debugging",
				scope: "builtin",
			}),
		];
		const extractedTriggers = { "systematic-debugging": ["调试", "错误"] };

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(
			result["systematic-debugging"].triggers.filter((t) => t === "调试"),
		).toHaveLength(1);
	});

	test("skips skills without description", () => {
		//#given
		const skills = [createSkill("no-desc")];
		const extractedTriggers = { "no-desc": ["trigger"] };

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(result["no-desc"]).toBeUndefined();
	});

	test("skips skills without extracted triggers", () => {
		//#given
		const skills = [
			createSkill("no-triggers", { description: "Has description" }),
		];
		const extractedTriggers = {};

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(result["no-triggers"]).toBeUndefined();
	});

	test("includes hash for change detection", () => {
		//#given
		const description = "Test description";
		const skills = [createSkill("test", { description })];
		const extractedTriggers = { test: ["keyword"] };

		//#when
		const result = buildCachedTriggers(skills, extractedTriggers);

		//#then
		expect(result.test.hash).toBe(hashDescription(description));
	});
});
