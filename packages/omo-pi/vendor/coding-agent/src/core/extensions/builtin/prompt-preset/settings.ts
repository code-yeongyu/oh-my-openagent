import type { Settings, SettingsManager } from "../../../settings-manager.ts";

export type PromptPresetName =
	| "auto"
	| "claude-fable-5"
	| "claude-opus-4-8"
	| "claude-opus-4-7"
	| "claude-opus-4-6"
	| "claude-opus-4-5"
	| "glm-5.2"
	| "kimi-k2-7"
	| "kimi-k2-6"
	| "gpt-5"
	| "gpt-5.2"
	| "gpt-5.3-codex"
	| "gpt-5.4"
	| "gpt-5.5";

export interface PromptPresetSettings {
	promptPreset: PromptPresetName;
}

type SettingsWithPromptPreset = Settings & { promptPreset?: string };

const VALID_PRESETS: ReadonlySet<string> = new Set<PromptPresetName>([
	"auto",
	"claude-fable-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-opus-4-5",
	"glm-5.2",
	"kimi-k2-7",
	"kimi-k2-6",
	"gpt-5",
	"gpt-5.2",
	"gpt-5.3-codex",
	"gpt-5.4",
	"gpt-5.5",
]);

export function parsePromptPreset(value: string | undefined): PromptPresetName | undefined {
	if (value && VALID_PRESETS.has(value)) {
		return value as PromptPresetName;
	}
	return undefined;
}

export function loadPromptPresetSettings(settingsManager: SettingsManager): PromptPresetSettings {
	const globalSettings = settingsManager.getGlobalSettings() as SettingsWithPromptPreset;
	const projectSettings = settingsManager.getProjectSettings() as SettingsWithPromptPreset;

	return {
		promptPreset:
			parsePromptPreset(projectSettings.promptPreset) ?? parsePromptPreset(globalSettings.promptPreset) ?? "auto",
	};
}
