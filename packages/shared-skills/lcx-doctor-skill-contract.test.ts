import { describe, expect, test } from "bun:test";

const skillPath = new URL("./skills/lcx-doctor/SKILL.md", import.meta.url);

describe("lcx-doctor SKILL.md contract", () => {
	test("#given lcx-doctor skill #when checked for temp path handling #then uses TMPDIR variable not hardcoded /tmp", async () => {
		const text = await Bun.file(skillPath).text();

		// Must use TMPDIR-aware pattern so the skill works when TMPDIR differs from /tmp
		expect(text).toContain("${TMPDIR:-/tmp}");

		// Must NOT hard-code bare /tmp as the sync destination root
		expect(text).not.toMatch(/sync_latest_source [^\n]+ \/tmp\//);
	});

	test("#given lcx-doctor skill #when checking plugin payload wiring #then does not expect obsolete hooks/hooks.json aggregate file", async () => {
		const text = await Bun.file(skillPath).text();

		// The aggregate manifest enumerates individual hook JSON files in the hooks array.
		// Checking for a single hooks/hooks.json is an obsolete expectation that produces
		// false-negative FAIL verdicts even on correct installs.
		expect(text).not.toMatch(/`hooks\/hooks\.json`[^`]*plugin payload/);
		// The wiring check section must not mention hooks/hooks.json as the expected payload artifact
		const wiringSection = text.slice(
			text.indexOf("Plugin payload present"),
			text.indexOf("Plugin payload present") + 200,
		);
		expect(wiringSection).not.toContain("hooks/hooks.json");
	});

	test("#given lcx-doctor skill #when instructed on source sync #then temp root variable is assigned before use", async () => {
		const text = await Bun.file(skillPath).text();

		// The skill must define SOURCE_ROOT (or equivalent) from TMPDIR before calling sync_latest_source
		expect(text).toMatch(/SOURCE_ROOT\s*=\s*"\$\{TMPDIR/);
	});
});
