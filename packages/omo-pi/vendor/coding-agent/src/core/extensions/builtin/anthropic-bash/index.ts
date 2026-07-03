import type { Api } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "../../types.ts";

type ToolDefinition = Record<string, unknown>;

const ANTHROPIC_BASH_ENV = "PI_ANTHROPIC_BASH";
const ANTHROPIC_NATIVE_BASH_TOOL = {
	type: "bash_20250124",
	name: "bash",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isBashType(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("bash_");
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
	const sanitizedTools: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}

		const shouldStripFunctionVariant = tool.name === "bash" && !isBashType(tool.type);
		if (!shouldStripFunctionVariant) {
			sanitizedTools.push(tool);
		}
	}
	return sanitizedTools;
}

export function isAnthropicBashEnabled(): boolean {
	const value = process.env[ANTHROPIC_BASH_ENV];
	if (!value) {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function addAnthropicBashToPayload(api: Api | undefined, payload: unknown): unknown {
	if (api !== "anthropic-messages") {
		return payload;
	}

	if (!isAnthropicBashEnabled()) {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeBash = sanitizedTools.some((tool) => isBashType(tool.type));
	if (!hasNativeBash) {
		sanitizedTools.push(ANTHROPIC_NATIVE_BASH_TOOL);
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export const ANTHROPIC_BASH_SECTION = `
## Bash Tool

The native bash tool is available in this session. The model has direct
shell access via the bash_20250124 tool. The session is stateless — each
command runs independently. The 'restart' parameter is accepted but has
no effect (no persistent shell session). Standard senpi safety
guardrails still apply.
`;

export default function anthropicBashExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addAnthropicBashToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}

		if (!isAnthropicBashEnabled()) {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${ANTHROPIC_BASH_SECTION}`,
		};
	});
}
