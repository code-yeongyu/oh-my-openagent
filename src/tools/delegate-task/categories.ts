import type { CategoriesConfig, CategoryConfig } from "../../config/schema";
import { log } from "../../shared/logger";
import {
	fuzzyMatchModel,
	isModelAvailable,
} from "../../shared/model-availability";
import type { ProfileName } from "../../shared/model-registry";
import { getProfileOverride } from "../../shared/model-registry";
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements";
import { resolveModel } from "../../shared/model-resolver";
import { CATEGORY_PROMPT_APPENDS, DEFAULT_CATEGORIES } from "./constants";

export interface ResolveCategoryConfigOptions {
	userCategories?: CategoriesConfig;
	modelProfile?: ProfileName;
	inheritedModel?: string;
	systemDefaultModel?: string;
	availableModels?: Set<string>;
}

export interface ResolveCategoryConfigResult {
	config: CategoryConfig;
	promptAppend: string;
	model: string | undefined;
	usedProfileOverride: boolean;
}

function resolveProfileCategoryModel(input: {
	categoryName: string;
	defaultModel?: string;
	modelProfile?: ProfileName;
	userModel?: string;
	availableModels?: Set<string>;
}): { model?: string; variant?: string } {
	const {
		categoryName,
		defaultModel,
		modelProfile,
		userModel,
		availableModels,
	} = input;

	if (userModel || !modelProfile) {
		return {};
	}

	const profileOverride = getProfileOverride(modelProfile, categoryName);
	if (!profileOverride) {
		return {};
	}

	const matchedModel = availableModels
		? (fuzzyMatchModel(profileOverride.model, availableModels) ?? undefined)
		: undefined;
	if (matchedModel) {
		return { model: matchedModel, variant: profileOverride.variant };
	}

	if (availableModels && availableModels.size > 0) {
		return {};
	}

	const defaultProvider = defaultModel?.split("/")[0];
	if (!defaultProvider) {
		return {};
	}

	return {
		model: `${defaultProvider}/${profileOverride.model}`,
		variant: profileOverride.variant,
	};
}

/**
 * Resolve the configuration for a given category name.
 * Merges default and user configurations, handles model resolution.
 */
export function resolveCategoryConfig(
	categoryName: string,
	options: ResolveCategoryConfigOptions,
): ResolveCategoryConfigResult | null {
	const {
		userCategories,
		modelProfile,
		inheritedModel: _inheritedModel,
		systemDefaultModel,
		availableModels,
	} = options;

	const defaultConfig = DEFAULT_CATEGORIES[categoryName];
	const userConfig = userCategories?.[categoryName];
	const hasExplicitUserConfig = userConfig !== undefined;

	if (userConfig?.disable) {
		return null;
	}

	const categoryReq = CATEGORY_MODEL_REQUIREMENTS[categoryName];
	if (categoryReq?.requiresModel && availableModels && !hasExplicitUserConfig) {
		if (!isModelAvailable(categoryReq.requiresModel, availableModels)) {
			log(
				`[resolveCategoryConfig] Category ${categoryName} requires ${categoryReq.requiresModel} but not available`,
			);
			return null;
		}
	}
	const defaultPromptAppend = CATEGORY_PROMPT_APPENDS[categoryName] ?? "";

	if (!defaultConfig && !userConfig) {
		return null;
	}

	const profileOverride = resolveProfileCategoryModel({
		categoryName,
		defaultModel: defaultConfig?.model,
		modelProfile,
		userModel: userConfig?.model,
		availableModels,
	});

	const model = resolveModel({
		userModel: userConfig?.model ?? profileOverride.model,
		inheritedModel: defaultConfig?.model,
		systemDefault: systemDefaultModel,
	});
	const config: CategoryConfig = {
		...defaultConfig,
		...userConfig,
		model,
		variant:
			userConfig?.variant ?? profileOverride.variant ?? defaultConfig?.variant,
	};

	let promptAppend = defaultPromptAppend;
	if (userConfig?.prompt_append) {
		promptAppend = defaultPromptAppend
			? `${defaultPromptAppend}\n\n${userConfig.prompt_append}`
			: userConfig.prompt_append;
	}

	return {
		config,
		promptAppend,
		model,
		usedProfileOverride: Boolean(profileOverride.model),
	};
}
