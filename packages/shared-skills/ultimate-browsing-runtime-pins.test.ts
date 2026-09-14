/// <reference types="bun-types" />

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const manifestPath = process.env.ULTIMATE_BROWSING_TEMPLATES_OVERRIDE
	?? join(import.meta.dir, "skills", "ultimate-browsing", "engine", "templates", "package.json");
const manifestSchema = z.object({ dependencies: z.record(z.string(), z.string()) });

test("uses only script dependencies when configuring local Chrome templates", () => {
	// Given: the template dependency manifest, not prose describing retired tools.
	const content = readFileSync(manifestPath, "utf8");

	// When: the package-manager input is parsed.
	const manifest = manifestSchema.parse(JSON.parse(content));

	// Then: local Chrome needs core plus the explicit script-only stealth lane.
	expect(Object.keys(manifest.dependencies).sort()).toEqual([
		"playwright-core",
		"playwright-extra",
		"puppeteer-extra-plugin-stealth",
	]);
});
