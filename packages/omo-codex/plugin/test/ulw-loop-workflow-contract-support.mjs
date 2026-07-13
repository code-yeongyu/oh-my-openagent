import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ulwLoopWorkflowPaths = [
	"components/ulw-loop/skills/ulw-loop/references/full-workflow.md",
	"skills/ulw-loop/references/full-workflow.md",
];

export async function readUlwLoopWorkflowArtifacts(pluginRoot) {
	return Promise.all(
		ulwLoopWorkflowPaths.map(async (relativePath) => ({
			relativePath,
			content: await readFile(join(pluginRoot, relativePath), "utf8"),
		})),
	);
}

export function parseSpawnContracts(content) {
	const invocationPattern =
		/`((?:agents|multi_agent_v1)\.spawn_agent\((\{[^`]+\})\))`/g;
	return [...content.matchAll(invocationPattern)].map((match) => {
		const tool = match[1].slice(0, match[1].indexOf("("));
		const args = JSON.parse(match[2]);
		assert.ok(args && typeof args === "object" && !Array.isArray(args));
		return {
			surface: tool === "agents.spawn_agent" ? "v2" : "v1",
			tool,
			args,
		};
	});
}
