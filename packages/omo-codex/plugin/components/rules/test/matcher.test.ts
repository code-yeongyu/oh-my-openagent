import { describe, expect, it } from "vitest";

import { matchRule, normalizeGlobs } from "@oh-my-opencode/rules-engine/engine";
import type { RuleFrontmatter } from "@oh-my-opencode/rules-engine/engine";

function matchFrontmatter(
	frontmatter: RuleFrontmatter,
	pathBases: {
		projectRelative: string;
		scopeRelative?: string;
		basename?: string;
	},
): ReturnType<typeof matchRule> {
	const scopeRelative = pathBases.scopeRelative;
	const pathBase = {
		projectRelative: pathBases.projectRelative,
		basename: pathBases.basename ?? pathBases.projectRelative.split("/").at(-1) ?? pathBases.projectRelative,
		...(scopeRelative === undefined ? {} : { scopeRelative }),
	};
	return matchRule({
		frontmatter,
		isSingleFile: false,
		pathBases: pathBase,
	});
}

function matchGlobs(globs: string | string[], projectRelative: string): boolean {
	return matchFrontmatter({ globs } satisfies RuleFrontmatter, { projectRelative }).matched;
}

describe("matchRule", () => {
	it("#given single-file rule #when matching any target #then it always matches", () => {
		// given
		const frontmatter = {} satisfies RuleFrontmatter;

		// when
		const result = matchRule({
			frontmatter,
			isSingleFile: true,
			pathBases: { projectRelative: "docs/readme.md", basename: "readme.md" },
		});

		// then
		expect(result).toEqual({ matched: true, reason: "single-file" });
	});

	it("#given always apply rule #when no glob is configured #then it matches", () => {
		// given
		const frontmatter = { alwaysApply: true } satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, { projectRelative: "src/app.ts" });

		// then
		expect(result).toEqual({ matched: true, reason: "alwaysApply" });
	});

	it("#given rule without patterns #when target is checked #then no match is returned", () => {
		// given
		const frontmatter = {} satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, { projectRelative: "src/app.ts" });

		// then
		expect(result).toEqual({ matched: false, reason: { kind: "no-match" } });
	});

	it("#given recursive glob #when target is nested #then matches without runtime dependencies", () => {
		// given
		const globs = "**/*.ts";

		// when
		const matched = matchGlobs(globs, "src/features/app.ts");

		// then
		expect(matched).toBe(true);
	});

	it("#given paths alias #when target matches #then glob match is returned", () => {
		// given
		const frontmatter = { paths: "src/**/*.ts" } satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, { projectRelative: "src/features/app.ts" });

		// then
		expect(result).toEqual({ matched: true, reason: { kind: "glob", pattern: "src/**/*.ts" } });
	});

	it("#given applyTo alias #when basename matches #then glob match is returned", () => {
		// given
		const frontmatter = { applyTo: "*.md" } satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, { projectRelative: "docs/README.md" });

		// then
		expect(result).toEqual({ matched: true, reason: { kind: "glob", pattern: "*.md" } });
	});

	it("#given scope-relative target #when scoped path matches #then glob match is returned", () => {
		// given
		const frontmatter = { globs: "components/**/*.tsx" } satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, {
			projectRelative: "packages/ui/components/button.tsx",
			scopeRelative: "components/button.tsx",
		});

		// then
		expect(result).toEqual({ matched: true, reason: { kind: "glob", pattern: "components/**/*.tsx" } });
	});

	it("#given backslash glob and target #when matching #then paths are normalized", () => {
		// given
		const frontmatter = { globs: "src\\**\\*.ts" } satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, { projectRelative: "src\\features\\app.ts" });

		// then
		expect(result).toEqual({ matched: true, reason: { kind: "glob", pattern: "src/**/*.ts" } });
	});

	it("#given multiple positive globs #when later glob matches #then matching pattern is reported", () => {
		// given
		const frontmatter = { globs: ["docs/**/*.md", "src/**/*.ts"] } satisfies RuleFrontmatter;

		// when
		const result = matchFrontmatter(frontmatter, { projectRelative: "src/features/app.ts" });

		// then
		expect(result).toEqual({ matched: true, reason: { kind: "glob", pattern: "src/**/*.ts" } });
	});

	it("#given negative glob #when target is excluded #then no match is returned", () => {
		// given
		const globs = ["**/*.ts", "!**/*.test.ts"];

		// when
		const matched = matchGlobs(globs, "src/features/app.test.ts");

		// then
		expect(matched).toBe(false);
	});

	it("#given question-mark glob #when one filename character differs #then target matches", () => {
		// given
		const globs = "src/app-?.ts";

		// when
		const matched = matchGlobs(globs, "src/app-a.ts");

		// then
		expect(matched).toBe(true);
	});

	it("#given brace glob #when target extension is listed #then matches", () => {
		// given
		const globs = "src/**/*.{ts,tsx}";

		// when
		const matched = matchGlobs(globs, "src/features/app.tsx");

		// then
		expect(matched).toBe(true);
	});

	it("#given character class glob #when matching listed extension #then target matches", () => {
		// given
		const globs = "src/**/*.[tj]s";

		// when
		const matched = matchGlobs(globs, "src/features/app.ts");

		// then
		expect(matched).toBe(true);
	});

	it("#given extglob pattern #when matching allowed extension #then target matches", () => {
		// given
		const globs = "src/**/*.@(ts|tsx)";

		// when
		const matched = matchGlobs(globs, "src/features/app.tsx");

		// then
		expect(matched).toBe(true);
	});

	it("#given duplicate normalized patterns #when normalizing #then first unique pattern order is kept", () => {
		// given
		const frontmatter = {
			globs: ["src\\**\\*.ts", "src/**/*.ts", "!src/**/*.test.ts"],
			paths: "!src/**/*.test.ts",
		} satisfies RuleFrontmatter;

		// when
		const patterns = normalizeGlobs(frontmatter);

		// then
		expect(patterns).toEqual(["src/**/*.ts", "!src/**/*.test.ts"]);
	});
});
