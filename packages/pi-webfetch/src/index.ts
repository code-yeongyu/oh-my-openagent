import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { renderWebfetchCall, renderWebfetchResult } from "./webfetch/renderers.js";
import { type WebfetchRenderDetails, webfetch } from "./webfetch/tool.js";

const ENABLE_ENV = "PI_WEBFETCH";
const STATUS_KEY = "pi-webfetch";
const WIDGET_KEY = "pi-webfetch";

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

export function isWebfetchEnabled(): boolean {
	return parseEnableEnv(ENABLE_ENV);
}

function clearUi(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

/**
 * pi-webfetch — URL retrieval for the pi coding agent.
 *
 * Registers one LLM-callable tool:
 *   - webfetch — fetch URL content as markdown, text, or html.
 */
export default function (pi: ExtensionAPI): void {
	// When PI_WEBFETCH disables the extension, keep factory callable but skip all registration side effects.
	if (!isWebfetchEnabled()) {
		return;
	}

	pi.registerTool<typeof webfetch.parameters, WebfetchRenderDetails>({
		...webfetch,
		renderCall: renderWebfetchCall,
		renderResult: renderWebfetchResult,
	});

	pi.on("session_start", async (_event, ctx) => {
		clearUi(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearUi(ctx);
	});
}
