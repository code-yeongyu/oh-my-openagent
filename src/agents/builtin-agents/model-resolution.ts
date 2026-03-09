import { resolveModelPipeline } from "../../shared";
import type { ProfileName } from "../../shared/model-registry";
import { getProfileOverride } from "../../shared/model-registry";
import { transformModelForProvider } from "../../shared/provider-model-id-transform";

export function applyModelResolution(input: {
	uiSelectedModel?: string;
	userModel?: string;
	profileName?: ProfileName;
	agentName?: string;
	requirement?: {
		fallbackChain?: { providers: string[]; model: string; variant?: string }[];
	};
	availableModels: Set<string>;
	systemDefaultModel?: string;
}) {
	const {
		uiSelectedModel,
		userModel,
		profileName,
		agentName,
		requirement,
		availableModels,
		systemDefaultModel,
	} = input;
	let resolvedUserModel = userModel;

	let resolvedVariant: string | undefined;

	if (!resolvedUserModel && profileName && agentName) {
		const profileOverride = getProfileOverride(profileName, agentName);
		if (profileOverride) {
			resolvedUserModel = profileOverride.model;
			resolvedVariant = profileOverride.variant;
		}
	}

	return resolveModelPipeline({
		intent: { uiSelectedModel, userModel: resolvedUserModel, userVariant: resolvedVariant },
		constraints: { availableModels },
		policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel, profileName, agentName },
	});
}

export function getFirstFallbackModel(requirement?: {
	fallbackChain?: { providers: string[]; model: string; variant?: string }[];
}) {
	const entry = requirement?.fallbackChain?.[0];
	if (!entry || entry.providers.length === 0) return undefined;
	const provider = entry.providers[0];
	const transformedModel = transformModelForProvider(provider, entry.model);
	return {
		model: `${provider}/${transformedModel}`,
		provenance: "provider-fallback" as const,
		variant: entry.variant,
	};
}
