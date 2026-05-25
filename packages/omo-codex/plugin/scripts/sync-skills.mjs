#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["ultragoal", "components/ultragoal/skills/ultragoal"],
];

await rm(join(root, "skills"), { recursive: true, force: true });
await mkdir(join(root, "skills"), { recursive: true });

for (const [name, source] of skillSources) {
	await cp(join(root, source), join(root, "skills", name), { recursive: true });
}
