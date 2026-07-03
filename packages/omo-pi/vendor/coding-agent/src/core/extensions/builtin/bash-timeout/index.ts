import type { ExtensionAPI } from "../../types.ts";

import {
	applyBashTimeout,
	type BashToolInputLike,
	buildBashTimeoutPrompt,
	resolveBashTimeoutDefaults,
} from "./timeout.ts";

export type { BashTimeoutDefaults, BashToolInputLike } from "./timeout.ts";
export {
	applyBashTimeout,
	BASH_DEFAULT_TIMEOUT_SECONDS,
	BASH_MAX_TIMEOUT_SECONDS,
	buildBashTimeoutPrompt,
	resolveBashTimeoutDefaults,
} from "./timeout.ts";

export default function bashTimeoutExtension(pi: ExtensionAPI): void {
	const env = typeof process !== "undefined" ? process.env : {};
	const defaults = resolveBashTimeoutDefaults(env);
	const promptSection = buildBashTimeoutPrompt(defaults);

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const input = event.input as BashToolInputLike;
		const updated = applyBashTimeout(input, defaults);
		if (updated !== input) {
			const timeout = updated.timeout;
			if (timeout !== undefined) input.timeout = timeout;
		}
	});

	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}${promptSection}`,
	}));
}
