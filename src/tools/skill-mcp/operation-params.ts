import type { SkillMcpArgs } from "./types";

export type OperationType = {
	type: "tool" | "resource" | "prompt" | "list_tools";
	name: string;
};

export function validateOperationParams(args: SkillMcpArgs): OperationType {
	const operations: OperationType[] = [];
	if (args.list_tools)
		operations.push({ type: "list_tools", name: "list_tools" });
	if (args.tool_name) operations.push({ type: "tool", name: args.tool_name });
	if (args.resource_name)
		operations.push({ type: "resource", name: args.resource_name });
	if (args.prompt_name)
		operations.push({ type: "prompt", name: args.prompt_name });

	if (operations.length === 0) {
		throw new Error(
			`Missing operation. Exactly one of tool_name, resource_name, or prompt_name must be specified.\n\n` +
				`Legacy compatibility: list_tools=true is also supported.\n\n` +
				`Examples:\n` +
				`  skill_mcp(mcp_name="sqlite", list_tools=true)\n` +
				`  skill_mcp(mcp_name="sqlite", tool_name="query", arguments='{"sql": "SELECT * FROM users"}')\n` +
				`  skill_mcp(mcp_name="memory", resource_name="memory://notes")\n` +
				`  skill_mcp(mcp_name="helper", prompt_name="summarize", arguments='{"text": "..."}')`,
		);
	}

	if (operations.length > 1) {
		const provided = [
			args.list_tools ? `list_tools=true` : undefined,
			args.tool_name && `tool_name="${args.tool_name}"`,
			args.resource_name && `resource_name="${args.resource_name}"`,
			args.prompt_name && `prompt_name="${args.prompt_name}"`,
		]
			.filter(Boolean)
			.join(", ");

		throw new Error(
			`Multiple operations specified. Exactly one of list_tools, tool_name, resource_name, or prompt_name must be provided.\n\n` +
				`Received: ${provided}\n\n` +
				`Use separate calls for each operation.`,
		);
	}

	return operations[0];
}

export function parseArguments(
	argsJson: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!argsJson) return {};
	if (typeof argsJson === "object" && argsJson !== null) {
		return argsJson;
	}

	try {
		const jsonStr =
			argsJson.startsWith("'") && argsJson.endsWith("'")
				? argsJson.slice(1, -1)
				: argsJson;
		const parsed = JSON.parse(jsonStr);
		if (typeof parsed !== "object" || parsed === null) {
			throw new Error("Arguments must be a JSON object");
		}

		return parsed as Record<string, unknown>;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Invalid arguments JSON: ${errorMessage}\n\n` +
				`Expected a valid JSON object, e.g.: '{"key": "value"}'\n` +
				`Received: ${argsJson}`,
		);
	}
}
