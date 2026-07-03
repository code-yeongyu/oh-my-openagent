import type { Api } from "@earendil-works/pi-ai";
import { SettingsManager } from "../../settings-manager.ts";
import type { ExtensionAPI, ServiceTier } from "../types.ts";

export type { ServiceTier };

type ProviderPayload = Record<string, unknown>;

const SERVICE_TIER_APIS: ReadonlySet<Api> = new Set(["openai-responses"]);

function isRecord(value: unknown): value is ProviderPayload {
	return typeof value === "object" && value !== null;
}

export function addServiceTierToPayload(api: Api | undefined, payload: unknown, serviceTier?: ServiceTier): unknown {
	if (!api || !SERVICE_TIER_APIS.has(api) || !serviceTier) {
		return payload;
	}

	if (!isRecord(payload) || payload.service_tier !== undefined) {
		return payload;
	}

	return {
		...payload,
		service_tier: serviceTier,
	};
}

export default function serviceTierExtension(pi: ExtensionAPI): void {
	let settingsServiceTier: ServiceTier | undefined;

	pi.on("session_start", async (_event, ctx) => {
		const settingsManager = SettingsManager.create(ctx.cwd);
		settingsServiceTier = settingsManager.getOpenAIServiceTier();
	});

	pi.on("before_provider_request", (event, ctx) => {
		const effectiveServiceTier = ctx.serviceTier ?? settingsServiceTier;
		return addServiceTierToPayload(ctx.model?.api, event.payload, effectiveServiceTier);
	});
}
