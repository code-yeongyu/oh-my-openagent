import type { ExtensionAPI } from "../../types.ts";
import { sanitizeAnthropicPayload } from "./sanitize-anthropic-payload.ts";
import { sanitizeOpenAIChatCompletionsPayload } from "./sanitize-openai-chat-completions-payload.ts";
import { sanitizeOpenAIResponsesPayload } from "./sanitize-openai-responses-payload.ts";

/** Guards provider requests by keeping tool-call/result pairs balanced. */
export default function toolPairGuardExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event) => {
		const sanitizedAnthropicPayload = sanitizeAnthropicPayload(event.payload);
		const sanitizedResponsesPayload = sanitizeOpenAIResponsesPayload(sanitizedAnthropicPayload);
		const sanitizedPayload = sanitizeOpenAIChatCompletionsPayload(sanitizedResponsesPayload);
		if (sanitizedPayload === event.payload) return undefined;
		return sanitizedPayload;
	});
}
