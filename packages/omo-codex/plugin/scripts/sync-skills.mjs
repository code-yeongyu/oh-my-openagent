#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedSkillsRoot = join(root, "..", "..", "shared-skills", "skills");
const skillsRoot = join(root, "skills");
const skillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["ultragoal", "components/ultragoal/skills/ultragoal"],
];

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

const codexHarnessToolCompatibility = `## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`spawn_agent(agent_type="explorer", task_name="...", message="...")\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`spawn_agent(agent_type="librarian", task_name="...", message="...")\` |
| \`task(subagent_type="plan", ...)\` | \`spawn_agent(agent_type="plan", task_name="...", message="...")\` |
| \`task(subagent_type="oracle", ...)\` for final verification | \`spawn_agent(agent_type="codex-ultrawork-reviewer", task_name="...", message="...")\` |
| \`task(category="...", ...)\` for implementation or QA | \`spawn_agent(agent_type="worker", task_name="...", message="...")\` |
| \`background_output(task_id="...")\` | \`wait_agent(...)\` to wait for subagent completion and mailbox updates |
| \`team_*(...)\` | Use Codex native subagents plus \`send_message\`, \`followup_task\`, \`wait_agent\`, and \`close_agent\` |

When translating \`load_skills=[...]\`, include the requested skill names in the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

`;

function insertCodexCompatibilityGuidance(content) {
	if (!opencodeOnlyOrchestrationPattern.test(content)) return content;
	if (content.includes("## Codex Harness Tool Compatibility")) return content;

	const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n+/);
	if (!frontmatterMatch) {
		return `${codexHarnessToolCompatibility}${content}`;
	}

	return `${frontmatterMatch[0]}${codexHarnessToolCompatibility}${content.slice(frontmatterMatch[0].length)}`;
}

async function adaptSkillForCodex(skillName) {
	const skillPath = join(skillsRoot, skillName, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const adapted = insertCodexCompatibilityGuidance(content);
	if (adapted !== content) {
		await writeFile(skillPath, adapted, "utf8");
	}
}

await rm(skillsRoot, { recursive: true, force: true });
await mkdir(skillsRoot, { recursive: true });

for (const [name, source] of skillSources) {
	await cp(join(root, source), join(skillsRoot, name), { recursive: true });
	await adaptSkillForCodex(name);
}

const sharedSkillEntries = await readdir(sharedSkillsRoot, { withFileTypes: true });
const sharedSkillNames = sharedSkillEntries
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

for (const skillName of sharedSkillNames) {
	await cp(join(sharedSkillsRoot, skillName), join(skillsRoot, skillName), { recursive: true });
	await adaptSkillForCodex(skillName);
}
