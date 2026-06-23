import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { materializeFrontendRefs } from "./scripts/materialize-frontend-refs.mjs";
import { brandStems, designpowersThirdPartyRelativePaths, frontendSkillRoot, thirdPartyRelativePaths, uiUxDbScripts } from "./scripts/frontend-refs-manifest.mjs";

describe("materialize-frontend-refs", () => {
	const result = materializeFrontendRefs({ strict: false });

	test("materializes the full third-party reference set when submodules are present", () => {
		// given the upstream submodules are initialized in this checkout
		if (result.skipped) return;
		// then every manifest target lands on disk
		for (const relPath of thirdPartyRelativePaths()) {
			expect(existsSync(join(frontendSkillRoot, relPath))).toBe(true);
		}
	});

	test("reproduces every brand design file and the ui-ux-db scripts", () => {
		if (result.skipped) return;
		// then the 69 brand files exist alongside the ui-ux-db scripts
		for (const brand of brandStems as string[]) {
			expect(existsSync(join(frontendSkillRoot, "references", "design", `${brand}.md`))).toBe(true);
		}
		for (const script of uiUxDbScripts as string[]) {
			expect(existsSync(join(frontendSkillRoot, "references", "ui-ux-db", "scripts", script))).toBe(true);
		}
	});

	test("materializes the designpowers reference corpus", () => {
		if (result.skipped) return;
		for (const relPath of designpowersThirdPartyRelativePaths()) {
			expect(existsSync(join(frontendSkillRoot, relPath))).toBe(true);
		}
	});

	test("materialized brand reference is verbatim upstream content", async () => {
		if (result.skipped) return;
		// given a known brand whose upstream keeps the leading Category blockquote
		const appleContent = await Bun.file(join(frontendSkillRoot, "references", "design", "apple.md")).text();
		// then the verbatim upstream blockquote is present (not abridged)
		expect(appleContent).toContain("> Category:");
	});

	test("missing submodule is a soft skip in non-strict mode", () => {
		// then a non-strict run always returns a structured result, never throws
		expect(typeof result.skipped).toBe("boolean");
	});
});
