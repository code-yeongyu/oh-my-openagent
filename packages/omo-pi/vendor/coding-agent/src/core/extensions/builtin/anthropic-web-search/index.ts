import type { Api } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "../../types.ts";

type ToolDefinition = Record<string, unknown>;

const WEB_SEARCH_MAX_USES = 8;
const ENABLE_ENV = "PI_ANTHROPIC_WEB_SEARCH";
const ALLOWED_DOMAINS_ENV = "PI_ANTHROPIC_WEB_SEARCH_ALLOWED_DOMAINS";
const BLOCKED_DOMAINS_ENV = "PI_ANTHROPIC_WEB_SEARCH_BLOCKED_DOMAINS";
const STATUS_KEY = "anthropic-web-search";
const WIDGET_KEY = "anthropic-web-search";

function parseEnableEnv(envVar: string): boolean {
	const envValue = process.env[envVar];
	if (!envValue) {
		return true;
	}

	const normalized = envValue.trim().toLowerCase();
	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}

	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}

	// Unknown values fall back to default-on behavior.
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isWebSearchType(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("web_search_");
}

function parseDomainListEnv(envVar: string): string[] | undefined {
	const envValue = process.env[envVar];
	if (!envValue) {
		return undefined;
	}

	const domains = envValue
		.split(",")
		.map((domain) => domain.trim())
		.filter((domain) => domain.length > 0);

	if (domains.length === 0) {
		return undefined;
	}

	return domains;
}

function makeWebSearchTool(): ToolDefinition {
	const allowedDomains = parseDomainListEnv(ALLOWED_DOMAINS_ENV);
	const blockedDomains = parseDomainListEnv(BLOCKED_DOMAINS_ENV);

	return {
		type: "web_search_20250305",
		name: "web_search",
		...(allowedDomains ? { allowed_domains: allowedDomains } : {}),
		...(blockedDomains ? { blocked_domains: blockedDomains } : {}),
		max_uses: WEB_SEARCH_MAX_USES,
	};
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
	const sanitized: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}

		const name = tool.name;
		const type = tool.type;
		const shouldStripFunctionVariant = name === "web_search" && !isWebSearchType(type);
		if (!shouldStripFunctionVariant) {
			sanitized.push(tool);
		}
	}
	return sanitized;
}

export function addAnthropicWebSearchToPayload(api: Api | undefined, payload: unknown): unknown {
	if (api !== "anthropic-messages") {
		return payload;
	}

	if (!isAnthropicWebSearchEnabled()) {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeWebSearch = sanitizedTools.some((tool) => isWebSearchType(tool.type));
	if (!hasNativeWebSearch) {
		sanitizedTools.push(makeWebSearchTool());
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export function isAnthropicWebSearchEnabled(): boolean {
	return parseEnableEnv(ENABLE_ENV);
}

function clearUi(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

function syncUi(ctx: ExtensionContext): void {
	clearUi(ctx);
}

export const ANTHROPIC_WEB_SEARCH_SECTION = `
## Web Search

The native web_search tool is available in this session.
Use web_search when the user asks for current or online information.
Prefer web_search over guessing when freshness matters.
`;

export default function anthropicWebSearchExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addAnthropicWebSearchToPayload(ctx.model?.api, event.payload);
	});

	pi.on("session_start", async (_event, ctx) => {
		syncUi(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		syncUi(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearUi(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}

		if (!isAnthropicWebSearchEnabled()) {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${ANTHROPIC_WEB_SEARCH_SECTION}`,
		};
	});
}
