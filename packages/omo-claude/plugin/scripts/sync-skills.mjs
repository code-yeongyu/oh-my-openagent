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

const opencodeOnlyOrchestrationPattern =
	/\b(?:call_omo_agent|background_output|team_[a-z_]+|task|spawn_agent|wait_agent|send_message|followup_task|close_agent)\s*\(/;

const claudeCodeHarnessHeading = "## Claude Code Harness Tool Compatibility";
const supersededCodexHeading = "## (superseded) Codex Harness Tool Compatibility";

const claudeCodeHarnessToolCompatibility = `${claudeCodeHarnessHeading}

This skill may include examples copied from the OpenCode or Codex harness. In Claude Code, do not call OpenCode/Codex-only tools such as \`task(...)\`, \`call_omo_agent(...)\`, \`spawn_agent(...)\`, \`background_output(...)\`, \`wait_agent(...)\`, \`team_*(...)\`, \`send_message(...)\`, \`followup_task(...)\`, or \`close_agent(...)\` literally. Translate those examples to Claude Code native tools:

| OpenCode / Codex example | Claude Code tool to use |
| --- | --- |
| \`task(subagent_type="explore", ...)\` / \`call_omo_agent(...)\` / \`spawn_agent(agent_type="explorer", ...)\` | the \`Task\` tool (spawn a subagent of the matching type) |
| \`task(subagent_type="plan"/"oracle", ...)\` / \`spawn_agent(agent_type="plan"/"reviewer", ...)\` | the \`Task\` tool with the planner/reviewer subagent, or the \`Skill\` tool |
| \`task(category="...", ...)\` | the \`Task\` tool (general-purpose subagent) or run the work inline |
| \`background_output(...)\` / \`wait_agent(...)\` | await the subagent's return value / the system completion notification |
| \`team_*(...)\` / \`send_message\`/\`followup_task\`/\`close_agent\` | run multiple \`Task\` subagents and synthesize their results |

When translating \`load_skills=[...]\`, invoke the requested skills with the \`Skill\` tool or pass their names in the spawned subagent's prompt. If a code block below conflicts with this section, this section wins.

`;

function demoteEmbeddedCodexCompatibility(content) {
	return content.replaceAll("## Codex Harness Tool Compatibility", supersededCodexHeading);
}

function insertClaudeCodeCompatibilityGuidance(content) {
	if (!opencodeOnlyOrchestrationPattern.test(content)) return content;
	if (content.includes(claudeCodeHarnessHeading)) return content;

	const demoted = demoteEmbeddedCodexCompatibility(content);

	const frontmatterMatch = demoted.match(/^---\n[\s\S]*?\n---\n+/);
	if (!frontmatterMatch) {
		return `${claudeCodeHarnessToolCompatibility}${demoted}`;
	}

	return `${frontmatterMatch[0]}${claudeCodeHarnessToolCompatibility}${demoted.slice(frontmatterMatch[0].length)}`;
}

async function adaptSkillForClaudeCode(skillName) {
	const skillPath = join(skillsRoot, skillName, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const adapted = insertClaudeCodeCompatibilityGuidance(content);
	if (adapted !== content) {
		await writeFile(skillPath, adapted, "utf8");
	}
}

await rm(skillsRoot, { recursive: true, force: true });
await mkdir(skillsRoot, { recursive: true });

for (const [name, source] of skillSources) {
	await cp(join(root, source), join(skillsRoot, name), { recursive: true });
	await adaptSkillForClaudeCode(name);
}

const sharedSkillEntries = await readdir(sharedSkillsRoot, { withFileTypes: true });
const sharedSkillNames = sharedSkillEntries
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

for (const skillName of sharedSkillNames) {
	await cp(join(sharedSkillsRoot, skillName), join(skillsRoot, skillName), { recursive: true });
	await adaptSkillForClaudeCode(skillName);
}
