import type { Api, Model } from "@earendil-works/pi-ai";
import { createApplyPatchTool } from "./tool.ts";
import type { ApplyPatchExtensionAPI, BaselineState } from "./types.ts";

// apply_patch ships as a freeform custom tool, which only the OpenAI Responses-family
// APIs can carry (openai-completions throws on freeform tools). Gate on the model's API
// rather than a provider allowlist so OpenAI-compatible custom providers (e.g. a proxy
// exposing gpt-5.5 via openai-responses) also swap edit/write for apply_patch.
const APPLY_PATCH_FREEFORM_APIS = new Set<Api>([
	"openai-responses",
	"azure-openai-responses",
	"openai-codex-responses",
]);
const EDIT_TOOL_NAMES = new Set(["write", "edit"]);

export function isOpenAIGptModel(model: Pick<Model<string>, "api" | "id"> | undefined): boolean {
	return model !== undefined && APPLY_PATCH_FREEFORM_APIS.has(model.api) && model.id.startsWith("gpt-");
}

function hasEditTools(toolNames: string[]): boolean {
	return toolNames.some((toolName) => EDIT_TOOL_NAMES.has(toolName));
}

function withoutApplyPatch(toolNames: string[]): string[] {
	return toolNames.filter((toolName) => toolName !== "apply_patch");
}

function replaceEditToolsWithApplyPatch(toolNames: string[]): string[] {
	const filteredToolNames = withoutApplyPatch(toolNames).filter((toolName) => !EDIT_TOOL_NAMES.has(toolName));
	if (!hasEditTools(toolNames)) return filteredToolNames;
	return [...filteredToolNames, "apply_patch"];
}

function restoreEditToolsFromBaseline(currentToolNames: string[], baselineToolNames: string[]): string[] {
	const restoredToolNames = [
		...withoutApplyPatch(currentToolNames),
		...baselineToolNames.filter((toolName) => EDIT_TOOL_NAMES.has(toolName)),
	];
	return [...new Set(restoredToolNames)];
}

function syncToolset(
	pi: Pick<ApplyPatchExtensionAPI, "getActiveTools" | "setActiveTools">,
	model: Model<string> | undefined,
	state: BaselineState,
): void {
	const currentToolNames = pi.getActiveTools();
	if (isOpenAIGptModel(model)) {
		if (hasEditTools(currentToolNames)) state.nonGptToolNames = withoutApplyPatch(currentToolNames);
		pi.setActiveTools(replaceEditToolsWithApplyPatch(currentToolNames));
		return;
	}

	if (state.nonGptToolNames.length > 0) {
		const restoredToolNames = restoreEditToolsFromBaseline(currentToolNames, state.nonGptToolNames);
		state.nonGptToolNames = restoredToolNames;
		pi.setActiveTools(restoredToolNames);
		return;
	}

	state.nonGptToolNames = withoutApplyPatch(currentToolNames);
	pi.setActiveTools(state.nonGptToolNames);
}

export function registerApplyPatchExtension(pi: ApplyPatchExtensionAPI): void {
	const state: BaselineState = { nonGptToolNames: [] };
	pi.registerTool(createApplyPatchTool());
	pi.on("session_start", async (_event, ctx) => {
		syncToolset(pi, ctx.model, state);
	});
	pi.on("model_select", async (event) => {
		syncToolset(pi, event.model, state);
	});
}

export default registerApplyPatchExtension;
