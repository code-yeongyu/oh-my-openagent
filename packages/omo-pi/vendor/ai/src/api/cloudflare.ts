import type { Api, Model, ProviderEnv } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";

const CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID";
const CLOUDFLARE_GATEWAY_ID = "CLOUDFLARE_GATEWAY_ID";

/** Workers AI direct endpoint. */
export const CLOUDFLARE_WORKERS_AI_BASE_URL =
	"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1";

/** AI Gateway Unified API. https://developers.cloudflare.com/ai-gateway/usage/unified-api/ */
export const CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL =
	"https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat";

/** AI Gateway → OpenAI passthrough. Used until /compat supports /v1/responses. */
export const CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL =
	"https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai";

/** AI Gateway → Anthropic passthrough. */
export const CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL =
	"https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic";

export function isCloudflareProvider(provider: string): boolean {
	return provider === "cloudflare-workers-ai" || provider === "cloudflare-ai-gateway";
}

export function resolveCloudflareBaseUrl(model: Model<Api>, env?: ProviderEnv): string {
	const accountId = getProviderEnvValue(CLOUDFLARE_ACCOUNT_ID, env) ?? "";
	const gatewayId = getProviderEnvValue(CLOUDFLARE_GATEWAY_ID, env) ?? "";
	return model.baseUrl
		.replaceAll(`{${CLOUDFLARE_ACCOUNT_ID}}`, accountId)
		.replaceAll(`{${CLOUDFLARE_GATEWAY_ID}}`, gatewayId);
}
