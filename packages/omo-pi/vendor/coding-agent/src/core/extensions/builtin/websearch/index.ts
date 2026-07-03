import type { ExtensionAPI, ExtensionContext } from "../../types.ts";

import { loadWebsearchConfig } from "./websearch/config.ts";
import { createWebSearchTool } from "./websearch/tool.ts";
import type { ConfigLoadResult, WebsearchConfig } from "./websearch/types.ts";

const STATUS_KEY = "pi-websearch";
const WIDGET_KEY = "pi-websearch";
const NATIVE_BYPASS_MESSAGE = "Native provider web search is handled by the built-in provider extension.";

type ProviderModelContext = {
	provider?: string;
	api?: string;
};

function isProviderNativeBypass(model: ProviderModelContext | undefined): boolean {
	// kimi-coding uses the anthropic-messages protocol but its search is the kimi provider (native route), not Anthropic-native; must not be bypassed.
	if (model?.provider === "kimi-coding") return false;
	return (
		model?.provider === "openai" ||
		model?.provider === "anthropic" ||
		model?.api === "anthropic-messages" ||
		model?.api === "openai-responses" ||
		model?.api === "azure-openai-responses"
	);
}

export default function (pi: ExtensionAPI): void {
	let state: ConfigLoadResult = {
		ok: false,
		reason: "missing_config",
		message: "Missing websearch config. Create .pi/websearch.json or ~/.pi/websearch.json before starting pi.",
	};

	function providerLabel(provider: WebsearchConfig["providers"][number]): string {
		return provider.id ? `${provider.id}/${provider.provider}` : provider.provider;
	}

	function providerList(config: WebsearchConfig): string {
		return config.providers.map(providerLabel).join(", ");
	}

	function clearUi(ctx: ExtensionContext): void {
		if (ctx.hasUI === false) return;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	function updateUi(ctx: ExtensionContext): void {
		if (ctx.hasUI === false) return;
		if (state.ok) {
			clearUi(ctx);
			return;
		}
		if (state.reason === "provider_native_bypass") {
			clearUi(ctx);
			return;
		}
		clearUi(ctx);
		ctx.ui.notify(state.message, "error");
	}

	pi.registerTool(createWebSearchTool(() => state));

	pi.on("session_start", async (_event, ctx) => {
		state = isProviderNativeBypass(ctx.model)
			? { ok: false, reason: "provider_native_bypass", message: NATIVE_BYPASS_MESSAGE }
			: await loadWebsearchConfig({ cwd: ctx.cwd });
		updateUi(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearUi(ctx);
	});

	pi.registerCommand("websearch", {
		description: "Show web search provider status",
		handler: async (rawArgs, ctx) => {
			const args = rawArgs.trim();
			if (args !== "" && args !== "status") {
				ctx.ui.notify("Usage: /websearch status", "warning");
				return;
			}
			if (state.ok) {
				ctx.ui.notify(
					`Web search active: strategy=${state.config.strategy}, auto=${state.config.auto ? "enabled" : "disabled"}, providers=${providerList(state.config)}`,
					"info",
				);
				return;
			}
			ctx.ui.notify(
				state.reason === "provider_native_bypass"
					? `Web search deferred: ${state.message}`
					: `Web search inactive: ${state.message}`,
				state.reason === "provider_native_bypass" ? "info" : "error",
			);
		},
	});
}
