import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createEngine, defaultConfig, type EngineDeps } from "../src/rules/engine.js";
import { matchRule as defaultMatchRule } from "../src/rules/matcher.js";
import type { RuleCandidate } from "../src/rules/types.js";

const projectRoot = "/tmp/codex-rules-engine";

function makeCandidate(): RuleCandidate {
	return {
		path: join(projectRoot, ".omo", "rules", "typescript.md"),
		realPath: join(projectRoot, ".omo", "rules", "typescript.md"),
		source: ".omo/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		relativePath: ".omo/rules/typescript.md",
	};
}

describe("rule engine dynamic matching", () => {
	it("#given duplicate target paths #when loading dynamic rules #then repeated discovery and parsing work is avoided", () => {
		// given
		const targetPath = join(projectRoot, "src", "app.ts");
		const candidate = makeCandidate();
		const counters = {
			findProjectRoot: 0,
			findCandidates: 0,
			readFile: 0,
		};
		const deps = {
			findProjectRoot: () => {
				counters.findProjectRoot += 1;
				return projectRoot;
			},
			findCandidates: () => {
				counters.findCandidates += 1;
				return [candidate];
			},
			readFile: () => {
				counters.readFile += 1;
				return ["---", "globs: **/*.ts", "---", "", "Prefer strict TypeScript."].join("\n");
			},
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		const result = engine.loadDynamicRules(projectRoot, [targetPath, targetPath, targetPath]);

		// then
		expect(result.rules).toHaveLength(1);
		expect(counters).toEqual({
			findProjectRoot: 1,
			findCandidates: 1,
			readFile: 1,
		});
	});

	it("#given distinct target files in same directory #when loading dynamic rules #then candidate discovery is reused", () => {
		// given
		const firstTarget = join(projectRoot, "src", "first.ts");
		const secondTarget = join(projectRoot, "src", "second.ts");
		const thirdTarget = join(projectRoot, "src", "third.ts");
		const candidate = makeCandidate();
		let findCandidatesCalls = 0;
		const deps = {
			findProjectRoot: () => projectRoot,
			findCandidates: () => {
				findCandidatesCalls += 1;
				return [candidate];
			},
			readFile: () => ["---", "globs: **/*.ts", "---", "", "Prefer strict TypeScript."].join("\n"),
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		const result = engine.loadDynamicRules(projectRoot, [firstTarget, secondTarget, thirdTarget]);

		// then
		expect(result.rules).toHaveLength(1);
		expect(findCandidatesCalls).toBe(1);
	});

	it("#given same rule content and target across loads #when loading dynamic rules repeats #then cached match decision is reused", () => {
		// given
		const targetPath = join(projectRoot, "src", "app.ts");
		const candidate = makeCandidate();
		let matchCalls = 0;
		const deps = {
			findProjectRoot: () => projectRoot,
			findCandidates: () => [candidate],
			readFile: () => ["---", "globs: **/*.ts", "---", "", "Prefer strict TypeScript."].join("\n"),
			matchRule: (input) => {
				matchCalls += 1;
				return defaultMatchRule(input);
			},
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		const firstResult = engine.loadDynamicRules(projectRoot, [targetPath]);
		const secondResult = engine.loadDynamicRules(projectRoot, [targetPath]);

		// then
		expect(firstResult.rules).toHaveLength(1);
		expect(secondResult.rules).toHaveLength(1);
		expect(matchCalls).toBe(1);
	});

	it("#given same rule path changes body #when loading dynamic rules repeats #then cached match decision invalidates", () => {
		// given
		const targetPath = join(projectRoot, "src", "app.ts");
		const candidate = makeCandidate();
		let body = "Prefer strict TypeScript.";
		let matchCalls = 0;
		const deps = {
			findProjectRoot: () => projectRoot,
			findCandidates: () => [candidate],
			readFile: () => ["---", "globs: **/*.ts", "---", "", body].join("\n"),
			matchRule: (input) => {
				matchCalls += 1;
				return defaultMatchRule(input);
			},
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		engine.loadDynamicRules(projectRoot, [targetPath]);
		body = "Prefer readonly TypeScript.";
		engine.loadDynamicRules(projectRoot, [targetPath]);

		// then
		expect(matchCalls).toBe(2);
	});

	it("#given same rule path changes frontmatter #when loading dynamic rules repeats #then cached match decision invalidates", () => {
		// given
		const targetPath = join(projectRoot, "src", "app.ts");
		const candidate = makeCandidate();
		let globs = "**/*.ts";
		let matchCalls = 0;
		const deps = {
			findProjectRoot: () => projectRoot,
			findCandidates: () => [candidate],
			readFile: () => ["---", `globs: ${globs}`, "---", "", "Prefer strict TypeScript."].join("\n"),
			matchRule: (input) => {
				matchCalls += 1;
				return defaultMatchRule(input);
			},
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		const firstResult = engine.loadDynamicRules(projectRoot, [targetPath]);
		globs = "**/*.tsx";
		const secondResult = engine.loadDynamicRules(projectRoot, [targetPath]);

		// then
		expect(firstResult.rules).toHaveLength(1);
		expect(secondResult.rules).toHaveLength(0);
		expect(matchCalls).toBe(2);
	});

	it("#given same rule and different targets #when loading dynamic rules repeats #then target-specific decisions do not leak", () => {
		// given
		const sourceTarget = join(projectRoot, "src", "app.ts");
		const testTarget = join(projectRoot, "src", "app.test.ts");
		const candidate = makeCandidate();
		let matchCalls = 0;
		const deps = {
			findProjectRoot: () => projectRoot,
			findCandidates: () => [candidate],
			readFile: () =>
				["---", 'globs: ["**/*.ts", "!**/*.test.ts"]', "---", "", "Prefer strict TypeScript."].join("\n"),
			matchRule: (input) => {
				matchCalls += 1;
				return defaultMatchRule(input);
			},
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		const sourceResult = engine.loadDynamicRules(projectRoot, [sourceTarget]);
		const testResult = engine.loadDynamicRules(projectRoot, [testTarget]);

		// then
		expect(sourceResult.rules).toHaveLength(1);
		expect(testResult.rules).toHaveLength(0);
		expect(matchCalls).toBe(2);
	});
});
