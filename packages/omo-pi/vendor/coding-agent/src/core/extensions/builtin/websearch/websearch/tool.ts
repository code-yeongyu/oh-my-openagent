import { Type } from "typebox";
import { defineTool } from "../../../types.ts";

import { buildNativeEntry, type NativeModelInfo, type NativeModelRegistry } from "./native.ts";
import { renderSearchCall, renderSearchResult } from "./renderers.ts";
import { createSearchRoutingState, formatSearchText, performSearch, type SearchRoutingState } from "./search.ts";
import type {
	ConfigLoadResult,
	SearchErrorDetails,
	SearchProgressDetails,
	SearchProviderEntry,
	SearchRenderDetails,
	WebsearchConfig,
} from "./types.ts";

const Params = Type.Object(
	{
		query: Type.String({ minLength: 2, description: "The search query to use" }),
		allowed_domains: Type.Optional(
			Type.Array(Type.String(), { description: "Only include search results from these domains" }),
		),
		blocked_domains: Type.Optional(
			Type.Array(Type.String(), { description: "Never include search results from these domains" }),
		),
	},
	{ additionalProperties: false },
);

export type ConfigProvider = () => ConfigLoadResult;
type WebSearchTool = ReturnType<typeof defineTool<typeof Params, SearchRenderDetails>>;

interface WebSearchToolContext {
	model: NativeModelInfo | undefined;
	modelRegistry: NativeModelRegistry;
}

async function configWithNativeRoute(config: WebsearchConfig, ctx?: WebSearchToolContext): Promise<WebsearchConfig> {
	if (!config.auto) return config;
	const nativeEntry = await buildNativeEntry(ctx?.model, ctx?.modelRegistry);
	return nativeEntry ? { ...config, providers: [nativeEntry, ...config.providers] } : config;
}

function providerLabel(provider: SearchProviderEntry): string {
	return provider.id ? `${provider.id}/${provider.provider}` : provider.provider;
}

function formatSearchProgressText(details: SearchProgressDetails): string {
	const route = details.providerLabels.length > 0 ? details.providerLabels.join(" -> ") : "configured providers";
	return `Searching "${details.query}" via ${route} (max ${details.maxResults})`;
}

function searchErrorDetails(query: string, error: string, reason?: SearchErrorDetails["reason"]): SearchErrorDetails {
	return { phase: "error", query, error, ...(reason ? { reason } : {}) };
}

export function createWebSearchTool(getConfig: ConfigProvider): WebSearchTool {
	let routingState: SearchRoutingState | undefined;
	let routingKey = "";

	return defineTool<typeof Params, SearchRenderDetails>({
		name: "web_search",
		label: "Web Search",
		description: "Search the web for current information and return source URLs for citation.",
		promptSnippet: "Search the web for current information, documentation, news, or external facts.",
		promptGuidelines: ["After using web_search, cite relevant returned URLs in the final answer."],
		parameters: Params,
		async execute(_toolCallId, params, signal, onUpdate, ctx?: WebSearchToolContext) {
			if (params.allowed_domains?.length && params.blocked_domains?.length) {
				const message = "Error: Cannot specify both allowed_domains and blocked_domains in the same request";
				const details = searchErrorDetails(params.query, message);
				return { content: [{ type: "text", text: message }], details };
			}

			const loaded = getConfig();
			if (!loaded.ok) {
				const details = searchErrorDetails(params.query, loaded.message, loaded.reason);
				return { content: [{ type: "text", text: loaded.message }], details };
			}

			const maxResults = loaded.config.providers[0]?.maxResults ?? 10;
			const config = await configWithNativeRoute(loaded.config, ctx);
			const progressDetails: SearchProgressDetails = {
				phase: "searching",
				query: params.query,
				providerLabels: config.providers.map(providerLabel),
				maxResults,
				strategy: config.strategy,
				...(params.allowed_domains ? { allowedDomains: params.allowed_domains } : {}),
				...(params.blocked_domains ? { blockedDomains: params.blocked_domains } : {}),
			};
			onUpdate?.({
				content: [{ type: "text", text: formatSearchProgressText(progressDetails) }],
				details: progressDetails,
			});

			const nextRoutingKey = `${config.strategy}:${config.providers.map((provider) => provider.id ?? provider.provider).join("|")}`;
			if (
				!routingState ||
				routingKey !== nextRoutingKey ||
				routingState.successCounts.length !== config.providers.length
			) {
				routingState = createSearchRoutingState(config.providers.length);
				routingKey = nextRoutingKey;
			}
			const request = {
				query: params.query,
				maxResults,
				...(params.allowed_domains === undefined ? {} : { allowedDomains: params.allowed_domains }),
				...(params.blocked_domains === undefined ? {} : { blockedDomains: params.blocked_domains }),
			};
			const details = await performSearch(config, request, signal, routingState);
			return { content: [{ type: "text", text: formatSearchText(details) }], details };
		},
		renderCall: (args, theme) => renderSearchCall(args, theme),
		renderResult: (result, options, theme) => renderSearchResult(result, options, theme),
	});
}

export const web_search = createWebSearchTool(() => ({
	ok: false,
	reason: "missing_config",
	message: "Missing websearch config. Create .pi/websearch.json or ~/.pi/websearch.json before starting pi.",
}));
