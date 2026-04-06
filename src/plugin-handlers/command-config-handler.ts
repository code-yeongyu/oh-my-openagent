import type { OhMyOpenCodeConfig } from "../config";
import { loadBuiltinCommands } from "../features/builtin-commands";
import {
	loadOpencodeGlobalCommands,
	loadOpencodeProjectCommands,
	loadProjectCommands,
	loadUserCommands,
} from "../features/claude-code-command-loader";
import {
	discoverConfigSourceSkills,
	loadGlobalAgentsSkills,
	loadOpencodeGlobalSkills,
	loadOpencodeProjectSkills,
	loadProjectAgentsSkills,
	loadProjectSkills,
	loadUserSkills,
	skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader";
import {
	detectExternalSkillPlugin,
	getSkillPluginConflictWarning,
	isOckBeadFirstProject,
	log,
} from "../shared";
import { getAgentListDisplayName } from "../shared/agent-display-names";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyCommandConfig(params: {
	config: Record<string, unknown>;
	pluginConfig: OhMyOpenCodeConfig;
	ctx: { directory: string };
	pluginComponents: PluginComponents;
}): Promise<void> {
	const beadFirstProject = isOckBeadFirstProject(params.ctx.directory);
	const builtinCommands = filterBuiltinCommandsForOckRepo(
		loadBuiltinCommands(params.pluginConfig.disabled_commands, {
			useRegisteredAgents: true,
		}),
		beadFirstProject,
	);
	const systemCommands =
		(params.config.command as Record<string, unknown>) ?? {};

	const includeClaudeCommands =
		params.pluginConfig.claude_code?.commands ?? true;
	const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;

	const externalSkillPlugin = detectExternalSkillPlugin(params.ctx.directory);
	if (includeClaudeSkills && externalSkillPlugin.detected) {
		log(getSkillPluginConflictWarning(externalSkillPlugin.pluginName!));
	}

	const [
		configSourceSkills,
		userCommands,
		projectCommands,
		opencodeGlobalCommands,
		opencodeProjectCommands,
		userSkills,
		globalAgentsSkills,
		projectSkills,
		projectAgentsSkills,
		opencodeGlobalSkills,
		opencodeProjectSkills,
	] = await Promise.all([
		discoverConfigSourceSkills({
			config: params.pluginConfig.skills,
			configDir: params.ctx.directory,
		}),
		includeClaudeCommands ? loadUserCommands() : Promise.resolve({}),
		includeClaudeCommands
			? loadProjectCommands(params.ctx.directory)
			: Promise.resolve({}),
		loadOpencodeGlobalCommands(),
		loadOpencodeProjectCommands(params.ctx.directory),
		includeClaudeSkills ? loadUserSkills() : Promise.resolve({}),
		includeClaudeSkills ? loadGlobalAgentsSkills() : Promise.resolve({}),
		includeClaudeSkills
			? loadProjectSkills(params.ctx.directory)
			: Promise.resolve({}),
		includeClaudeSkills
			? loadProjectAgentsSkills(params.ctx.directory)
			: Promise.resolve({}),
		loadOpencodeGlobalSkills(),
		loadOpencodeProjectSkills(params.ctx.directory),
	]);

	params.config.command = {
		...builtinCommands,
		...skillsToCommandDefinitionRecord(configSourceSkills),
		...userCommands,
		...userSkills,
		...globalAgentsSkills,
		...opencodeGlobalCommands,
		...opencodeGlobalSkills,
		...systemCommands,
		...projectCommands,
		...projectSkills,
		...projectAgentsSkills,
		...opencodeProjectCommands,
		...opencodeProjectSkills,
		...params.pluginComponents.commands,
		...params.pluginComponents.skills,
	};

	remapCommandAgentFields(
		params.config.command as Record<string, Record<string, unknown>>,
	);
}

const OCK_CONFLICTING_BUILTIN_COMMANDS = new Set([
	"start-work",
	"ralph-loop",
	"ulw-loop",
	"cancel-ralph",
	"stop-continuation",
]);

function filterBuiltinCommandsForOckRepo(
	commands: Record<string, unknown>,
	beadFirstProject: boolean,
): Record<string, unknown> {
	if (!beadFirstProject) {
		return commands;
	}

	return Object.fromEntries(
		Object.entries(commands).filter(
			([commandName]) => !OCK_CONFLICTING_BUILTIN_COMMANDS.has(commandName),
		),
	);
}

function remapCommandAgentFields(
	commands: Record<string, Record<string, unknown>>,
): void {
	for (const cmd of Object.values(commands)) {
		if (cmd?.agent && typeof cmd.agent === "string") {
			cmd.agent = getAgentListDisplayName(cmd.agent);
		}
	}
}
