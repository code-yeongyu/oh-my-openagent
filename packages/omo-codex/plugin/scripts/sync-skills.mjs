#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedSkillsRoot = sharedSkillsRootPath();
const skillsRoot = join(root, "skills");
const skillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["ulw-loop", "components/ulw-loop/skills/ulw-loop"],
	["ulw-plan", "components/ultrawork/skills/ulw-plan"],
];

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

const codexHarnessToolCompatibility = `## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`spawn_agent(agent_type="explorer", task_name="...", message="...", fork_turns="none")\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`spawn_agent(agent_type="librarian", task_name="...", message="...", fork_turns="none")\` |
| \`task(subagent_type="plan", ...)\` | \`spawn_agent(agent_type="plan", task_name="...", message="...", fork_turns="none")\` |
| \`task(subagent_type="oracle", ...)\` for final verification | \`spawn_agent(agent_type="codex-ultrawork-reviewer", task_name="...", message="...", fork_turns="none")\` |
| \`task(category="...", ...)\` for implementation or QA | \`spawn_agent(agent_type="worker", task_name="...", message="...", fork_turns="none")\` |
| \`background_output(task_id="...")\` | \`wait_agent(...)\` for mailbox signals; after a timeout, run one \`list_agents\` check for the named child if reassurance is needed |
| \`team_*(...)\` | Use Codex native subagents plus \`send_message\`, \`followup_task\`, \`wait_agent\`, and \`close_agent\` |

Codex full-history forks inherit the parent agent type, model, and reasoning effort, so role-specific spawns with \`agent_type\` must use a non-full-history fork mode such as \`fork_turns="none"\`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send \`WORKING: <task> - <current phase>\` before long passes and \`BLOCKED: <reason>\` only when progress stops. A \`wait_agent\` timeout only means no new mailbox update arrived. Treat a running child or latest \`WORKING:\` message as alive. Do not use \`list_agents\` as a polling loop. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly \`BLOCKED:\`, or no longer running.

`;

const codexCompatibilityEndMarkers = [
	"For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `wait_agent` timeout only means no new mailbox update arrived. Treat a running child or latest `WORKING:` message as alive. Do not use `list_agents` as a polling loop. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"Codex full-history forks inherit the parent agent type, model, and reasoning effort, so role-specific spawns with `agent_type` must use a non-full-history fork mode such as `fork_turns=\"none\"`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
];

function findCodexCompatibilitySectionEnd(content, searchStart) {
	const structuralEndPattern = /\n(?:---|#{1,6}\s)/g;
	structuralEndPattern.lastIndex = searchStart;
	const structuralEnd = structuralEndPattern.exec(content);
	if (structuralEnd) return structuralEnd.index + 1;

	const knownEndMarker = codexCompatibilityEndMarkers.find((marker) => content.indexOf(marker, searchStart) !== -1);
	if (knownEndMarker === undefined) return content.length;

	return content.indexOf(knownEndMarker, searchStart) + knownEndMarker.length;
}

function removeCodexCompatibilityGuidance(content) {
	const heading = "## Codex Harness Tool Compatibility";
	let withoutGuidance = content;

	while (true) {
		const start = withoutGuidance.indexOf(heading);
		if (start === -1) return withoutGuidance;

		const end = findCodexCompatibilitySectionEnd(withoutGuidance, start + heading.length);

		withoutGuidance = `${withoutGuidance.slice(0, start)}${withoutGuidance.slice(end)}`;
	}
}

export function insertCodexCompatibilityGuidance(content) {
	if (!opencodeOnlyOrchestrationPattern.test(content)) return content;
	const firstExampleIndex = content.search(opencodeOnlyOrchestrationPattern);
	const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
	if (compatibilityIndex !== -1 && compatibilityIndex < firstExampleIndex) return content;

	const contentWithoutGuidance = removeCodexCompatibilityGuidance(content);

	const frontmatterMatch = contentWithoutGuidance.match(/^---\n[\s\S]*?\n---\n+/);
	if (!frontmatterMatch) {
		return `${codexHarnessToolCompatibility}${contentWithoutGuidance}`;
	}

	return `${frontmatterMatch[0]}${codexHarnessToolCompatibility}${contentWithoutGuidance.slice(frontmatterMatch[0].length)}`;
}

async function adaptSkillForCodex(skillName) {
	const skillPath = join(skillsRoot, skillName, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const adapted = insertCodexCompatibilityGuidance(content);
	if (adapted !== content) {
		await writeFile(skillPath, adapted, "utf8");
	}
}

async function syncSkills() {
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await syncSkills();
}
