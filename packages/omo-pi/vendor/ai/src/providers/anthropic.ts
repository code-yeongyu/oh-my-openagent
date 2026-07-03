import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";

import type { AnthropicOptions } from "../api/anthropic-messages.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { SimpleStreamOptions, StreamFunction } from "../types.ts";
import { loadAnthropicOAuth } from "../utils/oauth/load.ts";
import { ANTHROPIC_MODELS } from "./anthropic.models.ts";

const anthropicStreams = anthropicMessagesApi();
export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = anthropicStreams.stream;
export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> =
	anthropicStreams.streamSimple;

export function anthropicProvider(): Provider<"anthropic-messages"> {
	return createProvider({
		id: "anthropic",
		name: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		auth: {
			// ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
			apiKey: envApiKeyAuth("Anthropic API key", ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]),
			oauth: lazyOAuth({ name: "Anthropic (Claude Pro/Max)", load: loadAnthropicOAuth }),
		},
		models: Object.values(ANTHROPIC_MODELS),
		api: anthropicMessagesApi(),
	});
}
