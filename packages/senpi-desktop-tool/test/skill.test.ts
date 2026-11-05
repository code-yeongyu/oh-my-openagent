import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeComputerSkill } from "../src/skill";

// Generated contract: the skill's method table is rendered from the SDK facade manifest, so every manifest
// method has exactly one row and no row names a method the manifest lost. A manifest edit without
// `bun run generate` in senpi-desktop-prelude fails here.
const SDK_MANIFEST = new URL("../../senpi-desktop-sdk/facade-manifest.json", import.meta.url);

function manifestMethods(): string[] {
	const parsed = JSON.parse(readFileSync(SDK_MANIFEST, "utf8")) as { methods: { method: string }[] };
	return parsed.methods.map((entry) => entry.method);
}

function methodTableRows(markdown: string): string[] {
	const section = markdown.split(/^## Methods$/m)[1]?.split(/^## /m)[0] ?? "";
	return section
		.split("\n")
		.filter((line) => line.startsWith("| ") && !line.startsWith("| SDK method "))
		.map((line) => line.slice(2).split("(")[0] ?? "");
}

describe("computer-use skill", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it("writes a SKILL.md whose method table has one row per facade-manifest method", () => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "computer-skill-test-"));
		roots.push(root);

		// When
		const rows = methodTableRows(readFileSync(materializeComputerSkill(root), "utf8"));

		// Then
		const methods = manifestMethods();
		expect(rows).toHaveLength(methods.length);
		expect(rows).toEqual(methods);
	});
});
