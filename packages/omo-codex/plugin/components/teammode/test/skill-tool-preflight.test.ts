import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillPath = join(__dirname, "..", "skills", "teammode", "SKILL.md");

describe("teammode skill tool preflight", () => {
	it("#given Codex thread tools are unavailable #when teammode is selected for implementation #then guidance degrades instead of stopping before work", () => {
		const skill = readFileSync(skillPath, "utf8");

		expect(skill).toContain("## Runtime tool preflight");
		expect(skill).toContain("do not stop an");
		expect(skill).toContain("ordinary implementation request with no code changed");
		expect(skill).toContain("best available non-team workflow");
		expect(skill).toContain("degraded non-team execution path");
	});
});
