import type { ModelFallbackInfo } from "../../features/task-toast-manager/types";
import { mergeCategories } from "../../shared/merge-categories";
import { isModelUnstable } from "../../shared/model-registry";
import type { FallbackEntry } from "../../shared/model-requirements";
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements";
import { getAvailableModelsForDelegateTask } from "./available-models";
import { resolveCategoryConfig } from "./categories";
import type { ExecutorContext } from "./executor-types";
import { resolveModelForDelegateTask } from "./model-selection";
import { parseModelString } from "./model-string-parser";
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent";
import type { DelegateTaskArgs } from "./types";

export interface CategoryResolutionResult {
	agentToUse: string;
	categoryModel:
		| { providerID: string; modelID: string; variant?: string }
		| undefined;
	categoryPromptAppend: string | undefined;
	maxPromptTokens?: number;
	modelInfo: ModelFallbackInfo | undefined;
	actualModel: string | undefined;
	isUnstableAgent: boolean;
	fallbackChain?: FallbackEntry[]; // For runtime retry on model errors
	error?: string;
}

export async function resolveCategoryExecution(
	args: DelegateTaskArgs,
	executorCtx: ExecutorContext,
	inheritedModel: string | undefined,
	systemDefaultModel: string | undefined,
): Promise<CategoryResolutionResult> {
	const { client, userCategories, sisyphusJuniorModel, modelProfile } =
		executorCtx;

	const availableModels = await getAvailableModelsForDelegateTask(client);

	const categoryName = args.category;
	if (!categoryName) {
		return {
			agentToUse: "",
			categoryModel: undefined,
			categoryPromptAppend: undefined,
			maxPromptTokens: undefined,
			modelInfo: undefined,
			actualModel: undefined,
			isUnstableAgent: false,
			error: "Category is required for category resolution.",
		};
	}
	const enabledCategories = mergeCategories(userCategories);
	const categoryExists = enabledCategories[categoryName] !== undefined;

	const resolved = resolveCategoryConfig(categoryName, {
		userCategories,
		modelProfile,
		inheritedModel,
		systemDefaultModel,
		availableModels,
	});

	if (!resolved) {
		const requirement = CATEGORY_MODEL_REQUIREMENTS[categoryName];
		const allCategoryNames = Object.keys(enabledCategories).join(", ");

		if (categoryExists && requirement?.requiresModel) {
			return {
				agentToUse: "",
				categoryModel: undefined,
				categoryPromptAppend: undefined,
				maxPromptTokens: undefined,
				modelInfo: undefined,
				actualModel: undefined,
				isUnstableAgent: false,
				error: `Category "${categoryName}" requires model "${requirement.requiresModel}" which is not available.

To use this category:
1. Connect a provider with this model: ${requirement.requiresModel}
2. Or configure an alternative model in your oh-my-opencode.json for this category

Available categories: ${allCategoryNames}`,
			};
		}

		return {
			agentToUse: "",
			categoryModel: undefined,
			categoryPromptAppend: undefined,
			maxPromptTokens: undefined,
			modelInfo: undefined,
			actualModel: undefined,
			isUnstableAgent: false,
			error: `Unknown category: "${categoryName}". Available: ${allCategoryNames}`,
		};
	}

	const requirement = CATEGORY_MODEL_REQUIREMENTS[categoryName];
	let actualModel: string | undefined;
	let modelInfo: ModelFallbackInfo | undefined;
	let categoryModel:
		| { providerID: string; modelID: string; variant?: string }
		| undefined;

	const overrideModel = sisyphusJuniorModel;
	const explicitCategoryModel = userCategories?.[categoryName]?.model;
	const hasPriorityOverride = Boolean(
		explicitCategoryModel || overrideModel || resolved.usedProfileOverride,
	);

	if (!requirement) {
		actualModel = explicitCategoryModel ?? overrideModel ?? resolved.model;
		if (actualModel) {
			modelInfo = hasPriorityOverride
				? { model: actualModel, type: "user-defined", source: "override" }
				: {
						model: actualModel,
						type: "system-default",
						source: "system-default",
					};
		}
	} else {
		const resolution = resolveModelForDelegateTask({
			userModel: explicitCategoryModel ?? overrideModel,
			categoryDefaultModel: resolved.model,
			fallbackChain: requirement.fallbackChain,
			availableModels,
			systemDefaultModel,
		});

		if (resolution) {
			const { model: resolvedModel, variant: resolvedVariant } = resolution;
			actualModel = resolvedModel;

			if (!parseModelString(actualModel)) {
				return {
					agentToUse: "",
					categoryModel: undefined,
					categoryPromptAppend: undefined,
					maxPromptTokens: undefined,
					modelInfo: undefined,
					actualModel: undefined,
					isUnstableAgent: false,
					error: `Invalid model format "${actualModel}". Expected "provider/model" format (e.g., "anthropic/claude-sonnet-4-6").`,
				};
			}

			const type:
				| "user-defined"
				| "inherited"
				| "category-default"
				| "system-default" = hasPriorityOverride
				? "user-defined"
				: systemDefaultModel && actualModel === systemDefaultModel
					? "system-default"
					: "category-default";

			const source: "override" | "category-default" | "system-default" =
				type === "user-defined"
					? "override"
					: type === "system-default"
						? "system-default"
						: "category-default";

			modelInfo = { model: actualModel, type, source };

			const parsedModel = parseModelString(actualModel);
			const variantToUse =
				userCategories?.[categoryName]?.variant ??
				resolvedVariant ??
				resolved.config.variant;
			categoryModel = parsedModel
				? variantToUse
					? { ...parsedModel, variant: variantToUse }
					: parsedModel
				: undefined;
		}
	}

	if (!categoryModel && actualModel) {
		const parsedModel = parseModelString(actualModel);
		categoryModel = parsedModel ?? undefined;
	}
	const categoryPromptAppend = resolved.promptAppend || undefined;

	if (!categoryModel && !actualModel) {
		const categoryNames = Object.keys(enabledCategories);
		return {
			agentToUse: "",
			categoryModel: undefined,
			categoryPromptAppend: undefined,
			maxPromptTokens: undefined,
			modelInfo: undefined,
			actualModel: undefined,
			isUnstableAgent: false,
			error: `Model not configured for category "${categoryName}".

Configure in one of:
1. OpenCode: Set "model" in opencode.json
2. Oh-My-OpenCode: Set category model in oh-my-opencode.json
3. Provider: Connect a provider with available models

Current category: ${categoryName}
Available categories: ${categoryNames.join(", ")}`,
		};
	}

	const actualModelID = actualModel
		? parseModelString(actualModel)?.modelID
		: undefined;
	const configModelID = resolved.config.model
		? parseModelString(resolved.config.model)?.modelID
		: undefined;
	const isUnstableAgent =
		resolved.config.is_unstable_agent === true ||
		isModelUnstable(actualModelID) ||
		isModelUnstable(configModelID);

	return {
		agentToUse: SISYPHUS_JUNIOR_AGENT,
		categoryModel,
		categoryPromptAppend,
		maxPromptTokens: resolved.config.max_prompt_tokens,
		modelInfo,
		actualModel,
		isUnstableAgent,
		fallbackChain: requirement?.fallbackChain,
	};
}
