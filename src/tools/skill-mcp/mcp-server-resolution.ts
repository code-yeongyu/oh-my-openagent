import type { ClaudeCodeMcpServer } from "../../features/claude-code-mcp-loader/types";
import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
import { BUILTIN_MCP_TOOL_HINTS } from "./constants";
import type { SkillMcpArgs } from "./types";

export interface ResolvedMcpServer {
	mcpName: string;
	skill: LoadedSkill;
	config: NonNullable<LoadedSkill["mcpConfig"]>[string];
	deprecationMessage?: string;
}

function findMcpServer(
	mcpName: string,
	skills: LoadedSkill[],
): {
	skill: LoadedSkill;
	config: NonNullable<LoadedSkill["mcpConfig"]>[string];
} | null {
	for (const skill of skills) {
		if (skill.mcpConfig && mcpName in skill.mcpConfig) {
			return { skill, config: skill.mcpConfig[mcpName] };
		}
	}

	return null;
}

function findSkillByName(
	skillName: string,
	skills: LoadedSkill[],
): LoadedSkill | null {
	for (const skill of skills) {
		if (skill.name === skillName) {
			return skill;
		}
	}

	return null;
}

function formatAvailableSkills(skills: LoadedSkill[]): string {
	const skillNames = skills.map((skill) => skill.name).sort();
	return skillNames.length > 0
		? skillNames.map((name) => `  - "${name}"`).join("\n")
		: "  (none found)";
}

export function formatAvailableMcps(skills: LoadedSkill[]): string {
	const mcps: string[] = [];
	for (const skill of skills) {
		if (skill.mcpConfig) {
			for (const serverName of Object.keys(skill.mcpConfig)) {
				mcps.push(`  - "${serverName}" from skill "${skill.name}"`);
			}
		}
	}

	return mcps.length > 0 ? mcps.join("\n") : "  (none found)";
}

export function formatBuiltinMcpHint(mcpName: string): string | null {
	const nativeTools = BUILTIN_MCP_TOOL_HINTS[mcpName];
	if (!nativeTools) return null;

	return (
		`"${mcpName}" is a builtin MCP, not a skill MCP.\n` +
		`Use the native tools directly:\n` +
		nativeTools.map((toolName) => `  - ${toolName}`).join("\n")
	);
}

export function resolveMcpServer(
	args: SkillMcpArgs,
	skills: LoadedSkill[],
): ResolvedMcpServer {
	if (args.mcp_name) {
		const found = findMcpServer(args.mcp_name, skills);
		if (!found) {
			const builtinHint = formatBuiltinMcpHint(args.mcp_name);
			if (builtinHint) {
				throw new Error(builtinHint);
			}

			throw new Error(
				`MCP server "${args.mcp_name}" not found.\n\n` +
					`Available MCP servers in loaded skills:\n` +
					formatAvailableMcps(skills) +
					`\n\n` +
					`Hint: Load the skill first using the 'skill' tool, then call skill_mcp.`,
			);
		}

		return {
			mcpName: args.mcp_name,
			skill: found.skill,
			config: found.config,
		};
	}

	if (!args.skill_name) {
		throw new Error(
			`Missing target MCP server. Provide mcp_name, or use legacy skill_name compatibility during the bridge window.\n\n` +
				`Available loaded skills:\n` +
				formatAvailableSkills(skills),
		);
	}

	const skill = findSkillByName(args.skill_name, skills);
	if (!skill) {
		throw new Error(
			`Skill "${args.skill_name}" is not loaded.\n\n` +
				`Available loaded skills:\n` +
				formatAvailableSkills(skills),
		);
	}

	const mcpConfig = skill.mcpConfig;
	if (!mcpConfig || Object.keys(mcpConfig).length === 0) {
		throw new Error(`Skill "${skill.name}" has no MCP servers configured.`);
	}

	const serverNames = Object.keys(mcpConfig);
	if (serverNames.length !== 1) {
		throw new Error(
			`Legacy skill_name compatibility is ambiguous for skill "${skill.name}".\n` +
				`This skill exposes multiple MCP servers: ${serverNames.join(", ")}.\n` +
				`Use mcp_name="<server>" explicitly instead.`,
		);
	}

	const [mcpName] = serverNames;
	return {
		mcpName,
		skill,
		config: mcpConfig[mcpName],
		deprecationMessage:
			`[deprecated] skill_name="${skill.name}" compatibility is temporary. ` +
			`Use mcp_name="${mcpName}" instead.`,
	};
}

export function getIncludedToolNames(
	config: ClaudeCodeMcpServer,
): string[] | null {
	return Array.isArray(config.includeTools) ? config.includeTools : null;
}

export function formatToolListOutput(
	tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
): string {
	return JSON.stringify(
		tools.map((toolDefinition) => ({
			name: toolDefinition.name,
			description: toolDefinition.description,
			inputSchema: toolDefinition.inputSchema,
		})),
		null,
		2,
	);
}
