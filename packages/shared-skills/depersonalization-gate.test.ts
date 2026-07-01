import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { runDepersonalizationGate } from "./depersonalization-gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("#given the vendored shared skills #when the de-personalization gate runs", () => {
	test("#then the cleaned ultimate-browsing + ulw-research tree has zero violations", async () => {
		// given
		const scanDirs = [join(here, "skills", "ultimate-browsing"), join(here, "skills", "ulw-research")];
		// when
		const violations = await runDepersonalizationGate(scanDirs, here);
		// then
		expect(violations).toEqual([]);
	});

	test("#then a planted personal token (jobdori) is caught", async () => {
		// given
		const dir = await mkdtemp(join(tmpdir(), "dp-gate-"));
		try {
			await writeFile(join(dir, "x.md"), "see jobdori machine for the build\n");
			// when
			const violations = await runDepersonalizationGate([dir], dir);
			// then
			expect(violations.length).toBeGreaterThan(0);
			expect(violations.some((v) => v.label.includes("jobdori"))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("#then a credential literal and home path are caught but a kept tier name is not", async () => {
		// given
		const dir = await mkdtemp(join(tmpdir(), "dp-gate-"));
		try {
			await writeFile(
				join(dir, "y.md"),
				"export TWITTER_AUTH_TOKEN=abc\nrun ~/.agent-reach/tools/x.sh\nuse agent-reach doctor to check channels\n",
			);
			// when
			const violations = await runDepersonalizationGate([dir], dir);
			const labels = violations.map((v) => v.label);
			// then
			expect(labels).toContain("credential-literal:TWITTER_AUTH_TOKEN");
			expect(labels.some((l) => l.includes("agent-reach-home"))).toBe(true);
			expect(labels.some((l) => l === "agent-reach")).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
