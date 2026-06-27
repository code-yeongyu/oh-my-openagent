import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const skillsRoot = join(import.meta.dir, "skills");

function readSkill(name: string): string {
	return readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
}

describe("shared skill harness guidance", () => {
	test("#given review-work is shared #when reading its guidance #then OpenCode remains the primary tool surface", () => {
		// given
		const skill = readSkill("review-work");

		// when
		const headingIndex = skill.indexOf("## Harness Tool Compatibility");
		const opencodeIndex = skill.indexOf("In OpenCode, use them literally");
		const codexIndex = skill.indexOf("In Codex only");

		// then
		expect(headingIndex).toBeGreaterThanOrEqual(0);
		expect(opencodeIndex).toBeGreaterThan(headingIndex);
		expect(codexIndex).toBeGreaterThan(opencodeIndex);
		expect(skill).toContain("pass the matching name as `agent_type` only when running under Codex");
		expect(skill).not.toContain("## Codex Harness Tool Compatibility");
	});

	test("#given start-work is shared #when reading its verifier guidance #then OpenCode is not sent to LazyCodex reviewers", () => {
		// given
		const skill = readSkill("start-work");

		// then
		expect(skill).toContain("In OpenCode, use OpenCode examples literally");
		expect(skill).toContain('in OpenCode use `task(subagent_type="oracle", ...)`');
		expect(skill).toContain("In Codex only");
		expect(skill).not.toContain("Execute a Prometheus work plan in Codex");
		expect(skill).not.toContain("## Codex Harness Tool Compatibility");
	});
});
