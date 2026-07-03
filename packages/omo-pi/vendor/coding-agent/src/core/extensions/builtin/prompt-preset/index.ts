import type { BuildDynamicSystemPromptOptions } from "../../../dynamic-prompt/build.ts";
import { SettingsManager } from "../../../settings-manager.ts";
import type { ExtensionAPI, ExtensionContext, ModelSelectEvent } from "../../types.ts";
import { resolvePreset, resolvePresetName } from "./presets.ts";
import { loadPromptPresetSettings } from "./settings.ts";

interface SystemPromptOptionsLike {
	cwd?: string;
	selectedTools?: string[];
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
	contextFiles?: Array<{ path: string; content: string }>;
	skills?: BuildDynamicSystemPromptOptions["skills"];
}

function eventOptionsToBuilderInput(
	event: { systemPromptOptions: SystemPromptOptionsLike | undefined },
	ctx: Pick<ExtensionContext, "cwd">,
): Partial<BuildDynamicSystemPromptOptions> {
	const options = event.systemPromptOptions ?? {};
	return {
		cwd: options.cwd ?? ctx.cwd,
		selectedTools: options.selectedTools,
		toolSnippets: options.toolSnippets,
		promptGuidelines: options.promptGuidelines,
		contextFiles: options.contextFiles,
		skills: options.skills,
	};
}

function getSettings(ctx: ExtensionContext): ReturnType<typeof loadPromptPresetSettings> {
	return loadPromptPresetSettings(SettingsManager.create(ctx.cwd));
}

function getPresetName(ctx: ExtensionContext, event?: Pick<ModelSelectEvent, "model">): string {
	const model = event?.model ?? ctx.model;
	if (!model) {
		return "fallback (senpi-current)";
	}
	return resolvePresetName(model, getSettings(ctx)) ?? "fallback (senpi-current)";
}

function refreshHeader(ctx: ExtensionContext, event?: Pick<ModelSelectEvent, "model">): void {
	const presetName = getPresetName(ctx, event);
	ctx.ui.setHeader((_tui, theme) => ({
		render: () => [theme.fg("accent", theme.bold(`Prompt preset: ${presetName}`))],
		invalidate: () => {},
	}));
}

export default function promptPresetExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event, ctx) => {
		const model = ctx.model;
		if (!model) {
			return undefined;
		}

		const preset = resolvePreset(model, getSettings(ctx), eventOptionsToBuilderInput(event, ctx));
		if (!preset) {
			return undefined;
		}

		return { systemPrompt: preset.prompt };
	});

	pi.on("session_start", async (_event, ctx) => {
		refreshHeader(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		refreshHeader(ctx, event);
		const preset = resolvePreset(event.model, getSettings(ctx), eventOptionsToBuilderInput(event, ctx));
		return {
			systemPrompt: preset?.prompt ?? null,
			systemPromptName: preset?.name ?? "fallback (senpi-current)",
		};
	});
}
