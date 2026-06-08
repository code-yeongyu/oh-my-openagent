import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FALLBACK_CODEX_MODEL_CATALOG = {
	current: {
		model: "gpt-5.5",
		modelContextWindow: 400_000,
		modelReasoningEffort: "high",
		planModeReasoningEffort: "xhigh",
	},
	managedProfiles: [
		{
			model: "gpt-5.5",
			modelContextWindow: 1_000_000,
			modelReasoningEffort: "high",
			planModeReasoningEffort: "xhigh",
		},
		{ model: "gpt-5.5", modelContextWindow: 272_000 },
	],
};

export async function readCodexModelCatalog(codexPackageRoot) {
	try {
		const parsed = JSON.parse(await readFile(join(codexPackageRoot, "plugin", "model-catalog.json"), "utf8"));
		return parseCodexModelCatalog(parsed) ?? FALLBACK_CODEX_MODEL_CATALOG;
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return FALLBACK_CODEX_MODEL_CATALOG;
	}
}

export async function readCodexReasoningProfile(codexPackageRoot) {
	return (await readCodexModelCatalog(codexPackageRoot)).current;
}

function parseCodexModelCatalog(value) {
	if (!isRecord(value) || !isRecord(value.current) || !Array.isArray(value.managedProfiles)) return null;
	const { current } = value;
	if (
		typeof current.model !== "string" ||
		typeof current.model_context_window !== "number" ||
		typeof current.model_reasoning_effort !== "string" ||
		typeof current.plan_mode_reasoning_effort !== "string"
	) {
		return null;
	}
	const managedProfiles = [];
	for (const profile of value.managedProfiles) {
		if (!isRecord(profile) || !isRecord(profile.match)) return null;
		managedProfiles.push(parseProfileMatch(profile.match));
	}
	return {
		current: {
			model: current.model,
			modelContextWindow: current.model_context_window,
			modelReasoningEffort: current.model_reasoning_effort,
			planModeReasoningEffort: current.plan_mode_reasoning_effort,
		},
		managedProfiles,
	};
}

function parseProfileMatch(match) {
	const profile = {};
	if (typeof match.model === "string") profile.model = match.model;
	if (typeof match.model_context_window === "number") profile.modelContextWindow = match.model_context_window;
	if (typeof match.model_reasoning_effort === "string") profile.modelReasoningEffort = match.model_reasoning_effort;
	if (typeof match.plan_mode_reasoning_effort === "string") profile.planModeReasoningEffort = match.plan_mode_reasoning_effort;
	return profile;
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
