import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FALLBACK_CATALOG = {
	version: "fallback.gpt-5.6-sol-372k-high",
	current: {
		model: "gpt-5.6-sol",
		model_context_window: 372_000,
		model_reasoning_effort: "high",
		plan_mode_reasoning_effort: "xhigh",
	},
	roles: {
		default: {
			model: "gpt-5.6-sol",
			model_context_window: 372_000,
			model_reasoning_effort: "high",
			plan_mode_reasoning_effort: "xhigh",
		},
		verifier: { model: "gpt-5.6-sol", model_reasoning_effort: "high" },
		worker: { model: "gpt-5.6-sol", model_reasoning_effort: "high" },
	},
	managedProfiles: [
		{
			version: "legacy.gpt-5.5-400k-reviewer-high",
			match: {
				model: "gpt-5.5",
				model_context_window: 400_000,
				model_reasoning_effort: "high",
				plan_mode_reasoning_effort: "xhigh",
			},
		},
		{
			version: "legacy.gpt-5.5-1m",
			match: {
				model: "gpt-5.5",
				model_context_window: 1_000_000,
				model_reasoning_effort: "high",
				plan_mode_reasoning_effort: "xhigh",
			},
		},
		{ version: "legacy.gpt-5.5-272k", match: { model: "gpt-5.5", model_context_window: 272_000 } },
	],
};

export async function readModelCatalog(env = process.env) {
	const catalogPath =
		env.LAZYCODEX_MODEL_CATALOG_PATH?.trim() || join(dirname(fileURLToPath(import.meta.url)), "..", "model-catalog.json");
	try {
		return parseCatalog(JSON.parse(await readFile(catalogPath, "utf8"))) ?? FALLBACK_CATALOG;
	} catch (error) {
		if (error instanceof Error) return FALLBACK_CATALOG;
		throw error;
	}
}

function parseCatalog(value) {
	if (!isRecord(value) || !isRecord(value.current) || !Array.isArray(value.managedProfiles)) return null;
	if (typeof value.version !== "string" || !isReasoningProfile(value.current)) return null;
	const managedProfiles = [];
	for (const profile of value.managedProfiles) {
		if (!isRecord(profile) || typeof profile.version !== "string" || !isRecord(profile.match)) return null;
		managedProfiles.push({ version: profile.version, match: profile.match });
	}
	return { version: value.version, current: value.current, managedProfiles, roles: isRecord(value.roles) ? value.roles : {} };
}

function isReasoningProfile(value) {
	return (
		isRecord(value) &&
		typeof value.model === "string" &&
		typeof value.model_context_window === "number" &&
		typeof value.model_reasoning_effort === "string" &&
		typeof value.plan_mode_reasoning_effort === "string"
	);
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
