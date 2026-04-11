import { type ToolDefinition, tool } from "@opencode-ai/plugin";
import type { ToolContext } from "@opencode-ai/plugin/tool";
import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
import type {
	SkillMcpClientInfo,
	SkillMcpManager,
	SkillMcpServerContext,
} from "../../features/skill-mcp-manager";
import { SKILL_MCP_DESCRIPTION } from "./constants";
import {
	formatToolListOutput,
	getIncludedToolNames,
	resolveMcpServer,
} from "./mcp-server-resolution";
import { parseArguments, validateOperationParams } from "./operation-params";
import type { SkillMcpArgs } from "./types";

interface SkillMcpToolOptions {
	manager: SkillMcpManager;
	getLoadedSkills: () => LoadedSkill[];
	getSessionID?: () => string | undefined;
}

export function applyGrepFilter(
	output: string,
	pattern: string | undefined,
): string {
	if (!pattern) return output;
	try {
		const regex = new RegExp(pattern, "i");
		const lines = output.split("\n");
		const filtered = lines.filter((line) => regex.test(line));
		return filtered.length > 0
			? filtered.join("\n")
			: `[grep] No lines matched pattern: ${pattern}`;
	} catch {
		return output;
	}
}

export function createSkillMcpTool(
	options: SkillMcpToolOptions,
): ToolDefinition {
	const { manager, getLoadedSkills, getSessionID } = options;

	return tool({
		description: SKILL_MCP_DESCRIPTION,
		args: {
			mcp_name: tool.schema
				.string()
				.optional()
				.describe("Name of the MCP server from skill config"),
			skill_name: tool.schema
				.string()
				.optional()
				.describe(
					"Legacy compatibility: loaded skill name to resolve when exactly one MCP server exists",
				),
			list_tools: tool.schema
				.boolean()
				.optional()
				.describe(
					"Legacy compatibility: list available tools for the resolved MCP server",
				),
			tool_name: tool.schema.string().optional().describe("MCP tool to call"),
			resource_name: tool.schema
				.string()
				.optional()
				.describe("MCP resource URI to read"),
			prompt_name: tool.schema
				.string()
				.optional()
				.describe("MCP prompt to get"),
			arguments: tool.schema
				.union([tool.schema.string(), tool.schema.object({})])
				.optional()
				.describe("JSON string or object of arguments"),
			grep: tool.schema
				.string()
				.optional()
				.describe(
					"Regex pattern to filter output lines (only matching lines returned)",
				),
		},
		async execute(args: SkillMcpArgs, toolContext: ToolContext) {
			const operation = validateOperationParams(args);
			const skills = getLoadedSkills();
			const resolved = resolveMcpServer(args, skills);

			const sessionID = toolContext.sessionID || getSessionID?.();
			if (!sessionID) {
				throw new Error("No active session available for skill MCP call.");
			}

			const info: SkillMcpClientInfo = {
				serverName: resolved.mcpName,
				skillName: resolved.skill.name,
				sessionID,
				scope: resolved.skill.scope,
			};

			const context: SkillMcpServerContext = {
				config: resolved.config,
				skillName: resolved.skill.name,
			};

			const parsedArgs = parseArguments(args.arguments);

			let output: string;
			switch (operation.type) {
				case "list_tools": {
					const availableTools = await manager.listTools(info, context);
					const includeTools = getIncludedToolNames(resolved.config);
					const filteredTools = includeTools
						? availableTools.filter((toolDefinition) =>
								includeTools.includes(toolDefinition.name),
							)
						: availableTools;
					output = formatToolListOutput(filteredTools);
					break;
				}
				case "tool": {
					const result = await manager.callTool(
						info,
						context,
						operation.name,
						parsedArgs,
					);
					output = JSON.stringify(result, null, 2);
					break;
				}
				case "resource": {
					const result = await manager.readResource(
						info,
						context,
						operation.name,
					);
					output = JSON.stringify(result, null, 2);
					break;
				}
				case "prompt": {
					const stringArgs: Record<string, string> = {};
					for (const [key, value] of Object.entries(parsedArgs)) {
						stringArgs[key] = String(value);
					}
					const result = await manager.getPrompt(
						info,
						context,
						operation.name,
						stringArgs,
					);
					output = JSON.stringify(result, null, 2);
					break;
				}
			}

			const filteredOutput = applyGrepFilter(output, args.grep);
			if (resolved.deprecationMessage) {
				return `${resolved.deprecationMessage}\n\n${filteredOutput}`;
			}

			return filteredOutput;
		},
	});
}
