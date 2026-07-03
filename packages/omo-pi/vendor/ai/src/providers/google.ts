import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.ts";

import type { GoogleOptions } from "../api/google-generative-ai.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { SimpleStreamOptions, StreamFunction } from "../types.ts";
import { GOOGLE_MODELS } from "./google.models.ts";

const googleStreams = googleGenerativeAIApi();
export const streamGoogle: StreamFunction<"google-generative-ai", GoogleOptions> = googleStreams.stream;
export const streamSimpleGoogle: StreamFunction<"google-generative-ai", SimpleStreamOptions> =
	googleStreams.streamSimple;

export function googleProvider(): Provider<"google-generative-ai"> {
	return createProvider({
		id: "google",
		name: "Google",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		auth: { apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]) },
		models: Object.values(GOOGLE_MODELS),
		api: googleGenerativeAIApi(),
	});
}
