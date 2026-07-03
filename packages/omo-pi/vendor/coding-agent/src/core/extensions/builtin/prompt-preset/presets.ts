import type { Api, Model } from "@earendil-works/pi-ai";
import type { BuildDynamicSystemPromptOptions } from "../../../dynamic-prompt/build.ts";
import { buildClaudeFable5Prompt } from "./claude-fable-5.ts";
import { buildClaudeOpus45Prompt } from "./claude-opus-4-5.ts";
import { buildClaudeOpus46Prompt } from "./claude-opus-4-6.ts";
import { buildClaudeOpus47Prompt } from "./claude-opus-4-7.ts";
import { buildClaudeOpus48Prompt } from "./claude-opus-4-8.ts";
import { buildGlm52Prompt } from "./glm-5-2.ts";
import { buildGpt52Prompt } from "./gpt-5.2.ts";
import { buildGpt53CodexPrompt } from "./gpt-5.3-codex.ts";
import { buildGpt54Prompt } from "./gpt-5.4.ts";
import { buildGpt55Prompt } from "./gpt-5.5.ts";
import { buildGpt5Prompt } from "./gpt-5.ts";
import { buildKimiK26Prompt } from "./kimi-k2-6.ts";
import { buildKimiK27Prompt } from "./kimi-k2-7.ts";
import { type PromptPresetName, type PromptPresetSettings, parsePromptPreset } from "./settings.ts";

export type { PromptPresetSettings } from "./settings.ts";

type ResolvedPresetName = Exclude<PromptPresetName, "auto">;
type ModelWithPromptPresetMetadata = Pick<Model<Api>, "id" | "provider"> & {
	name?: string;
	promptPreset?: string;
};

export interface ResolvedPromptPreset {
	name: ResolvedPresetName;
	prompt: string;
}

function normalizeModelId(modelId: string): string {
	return modelId.toLowerCase().replace(/\s+/g, "-");
}

type Gpt5Version = "gpt-5.2" | "gpt-5.3-codex" | "gpt-5.4" | "gpt-5.5";

function extractGpt5Version(modelId: string): Gpt5Version | undefined {
	const normalized = normalizeModelId(modelId);
	if (normalized.includes("gpt-5.5")) {
		return "gpt-5.5";
	}
	if (normalized.includes("gpt-5.4")) {
		return "gpt-5.4";
	}
	if (normalized.includes("gpt-5.3")) {
		return "gpt-5.3-codex";
	}
	if (normalized.includes("gpt-5.2")) {
		return "gpt-5.2";
	}
	return undefined;
}

function hasKimiK26Signal(value: string): boolean {
	return /(?:^|[/@._-])kimi-k2(?:[._-]|p)6(?:$|[/@._:-])/.test(normalizeModelId(value));
}

function isKimiK26Model(model: ModelWithPromptPresetMetadata): boolean {
	return hasKimiK26Signal(model.id) || (model.name !== undefined && hasKimiK26Signal(model.name));
}

function hasKimiK27Signal(value: string): boolean {
	return /(?:^|[/@._-])kimi-k2(?:[._-]|p)7(?:$|[/@._:-])/.test(normalizeModelId(value));
}

function isKimiK27Model(model: ModelWithPromptPresetMetadata): boolean {
	return hasKimiK27Signal(model.id) || (model.name !== undefined && hasKimiK27Signal(model.name));
}

function hasGlm52Signal(value: string): boolean {
	return /(?:^|[/@._-])glm(?:[._-]|p)5(?:[._-]|p)2(?:$|[/@._:-])/.test(normalizeModelId(value));
}

function isGlm52Model(model: ModelWithPromptPresetMetadata): boolean {
	return hasGlm52Signal(model.id) || (model.name !== undefined && hasGlm52Signal(model.name));
}

function isClaudeFable5Model(modelId: string): boolean {
	return normalizeModelId(modelId).includes("fable-5");
}

type ClaudeOpusVersion = "claude-opus-4-8" | "claude-opus-4-7" | "claude-opus-4-6" | "claude-opus-4-5";

function extractClaudeOpusVersion(modelId: string): ClaudeOpusVersion | undefined {
	const normalized = normalizeModelId(modelId);
	if (normalized.includes("opus-4-8")) {
		return "claude-opus-4-8";
	}
	if (normalized.includes("opus-4-7")) {
		return "claude-opus-4-7";
	}
	if (normalized.includes("opus-4-6")) {
		return "claude-opus-4-6";
	}
	if (normalized.includes("opus-4-5") || normalized.includes("opus-4.5")) {
		return "claude-opus-4-5";
	}
	return undefined;
}

export function resolvePresetName(
	model: ModelWithPromptPresetMetadata,
	settings: PromptPresetSettings,
): ResolvedPresetName | undefined {
	if (settings.promptPreset !== "auto") {
		return settings.promptPreset;
	}

	const modelPromptPreset = parsePromptPreset(model.promptPreset);
	if (modelPromptPreset && modelPromptPreset !== "auto") {
		return modelPromptPreset;
	}

	const gpt5Version = extractGpt5Version(model.id);
	if (gpt5Version) {
		return gpt5Version;
	}
	if (isKimiK27Model(model)) {
		return "kimi-k2-7";
	}
	if (isKimiK26Model(model)) {
		return "kimi-k2-6";
	}
	if (isClaudeFable5Model(model.id)) {
		return "claude-fable-5";
	}
	const claudeVersion = extractClaudeOpusVersion(model.id);
	if (claudeVersion) {
		return claudeVersion;
	}
	if (isGlm52Model(model)) {
		return "glm-5.2";
	}
	return undefined;
}

function buildPreset(name: ResolvedPresetName, options: BuildDynamicSystemPromptOptions): ResolvedPromptPreset {
	switch (name) {
		case "gpt-5.5":
			return { name, prompt: buildGpt55Prompt(options) };
		case "gpt-5.4":
			return { name, prompt: buildGpt54Prompt(options) };
		case "gpt-5.3-codex":
			return { name, prompt: buildGpt53CodexPrompt(options) };
		case "gpt-5.2":
			return { name, prompt: buildGpt52Prompt(options) };
		case "gpt-5":
			return { name, prompt: buildGpt5Prompt(options) };
		case "glm-5.2":
			return { name, prompt: buildGlm52Prompt(options) };
		case "kimi-k2-7":
			return { name, prompt: buildKimiK27Prompt(options) };
		case "kimi-k2-6":
			return { name, prompt: buildKimiK26Prompt(options) };
		case "claude-fable-5":
			return { name, prompt: buildClaudeFable5Prompt(options) };
		case "claude-opus-4-8":
			return { name, prompt: buildClaudeOpus48Prompt(options) };
		case "claude-opus-4-7":
			return { name, prompt: buildClaudeOpus47Prompt(options) };
		case "claude-opus-4-6":
			return { name, prompt: buildClaudeOpus46Prompt(options) };
		case "claude-opus-4-5":
			return { name, prompt: buildClaudeOpus45Prompt(options) };
	}
}

function withDefaults(options: Partial<BuildDynamicSystemPromptOptions> = {}): BuildDynamicSystemPromptOptions {
	return {
		cwd: options.cwd ?? "",
		selectedTools: options.selectedTools ?? [],
		toolSnippets: options.toolSnippets ?? {},
		promptGuidelines: options.promptGuidelines ?? [],
		contextFiles: options.contextFiles ?? [],
		skills: options.skills ?? [],
	};
}

export function resolvePreset(
	model: ModelWithPromptPresetMetadata,
	settings: PromptPresetSettings,
	options?: Partial<BuildDynamicSystemPromptOptions>,
): ResolvedPromptPreset | undefined {
	const name = resolvePresetName(model, settings);
	if (!name) {
		return undefined;
	}
	return buildPreset(name, withDefaults(options));
}
