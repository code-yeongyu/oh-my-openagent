import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { insertCodexCompatibilityGuidance } from "../scripts/sync-skills.mjs";
import {
	assertCompatibilityContract,
	assertNoV1OnlyUnitsAfterV2Mapping,
} from "./sync-skills-orchestration-contract-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function generatedCompatibilityBlock() {
	return insertCodexCompatibilityGuidance(
		'---\nname: example\n---\n\n# Example Skill\n\ntask(subagent_type="oracle", load_skills=["debugging"], prompt="verify")\n',
	);
}

test("#given generated Codex compatibility guidance #when spawn and lifecycle examples are parsed #then GPT-5.6 keeps the V2 contract", () => {
	assertCompatibilityContract(
		generatedCompatibilityBlock(),
		"generated compatibility block",
	);
});

test("#given generated compatibility and the Codex prompt #when V2 mappings are inventoried #then V1-only units have V2 equivalents", async () => {
	const codexPrompt = await readFile(
		join(root, "../../prompts-core/prompts/ultrawork/codex.md"),
		"utf8",
	);

	for (const [label, content] of [
		["generated compatibility", generatedCompatibilityBlock()],
		["Codex ultrawork prompt", codexPrompt],
	]) {
		assertNoV1OnlyUnitsAfterV2Mapping(content, label);
	}
});
