import { isGptModel, isGptNativeSisyphusModel } from "../../../agents/types";
import { getAgentConfigKey } from "../../../shared/agent-display-names";
import type { FallbackEntry } from "../../../shared/model-requirements";
import {
	AGENT_MODEL_REQUIREMENTS,
	CATEGORY_MODEL_REQUIREMENTS,
} from "../../../shared/model-requirements";
import type {
	DelegatedModelConfig,
	ModelIntent,
} from "../../../shared/model-resolution-types";
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { DelegateTaskArgs } from "../../../tools/delegate-task/types";
import type { Member } from "../types";
import {
	filterReachableChainEntries,
	type MemberSelectionPolicy,
	pickCreativeChainEntry,
	pickEntryProvider,
	type StableSeed,
	TEAM_MEMBER_MODEL_INTENT,
} from "./member-selection-policy";
import {
	buildSystemContent,
	resolveCategoryExecution,
	resolveSubagentExecution,
} from "./resolve-member-dependencies";

export class TeamMemberResolutionError extends Error {
	constructor(
		public readonly memberName: string,
		public readonly cause: Error,
	) {
		super(`Failed to resolve member '${memberName}': ${cause.message}`);
		this.name = "TeamMemberResolutionError";
	}
}

export interface ResolvedMember {
	memberName: string;
	agentToUse: string;
	model: DelegatedModelConfig | undefined;
	fallbackChain: FallbackEntry[] | undefined;
	systemContent: string;
	/**
	 * Sticky-model intent surfaced from the subagent resolver. "explicit"
	 * means the user named this model via `agents.<name>.model` config —
	 * the launched task must refuse silent fallback. Undefined / "auto"
	 * preserves the existing chain-advancement behavior.
	 */
	modelIntent?: ModelIntent;
}

function createBaseDelegateTaskArgs(
	prompt: string,
): Pick<
	DelegateTaskArgs,
	"description" | "load_skills" | "prompt" | "run_in_background"
> {
	return {
		description: "Resolve team member",
		load_skills: [],
		prompt,
		run_in_background: false,
	};
}

function normalizeResolutionError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function resolveSystemContent(input: {
	agentToUse: string;
	categoryPromptAppend?: string;
	maxPromptTokens?: number;
	model: DelegatedModelConfig | undefined;
}): string {
	return (
		buildSystemContent({
			agentName: input.agentToUse,
			categoryPromptAppend: input.categoryPromptAppend,
			maxPromptTokens: input.maxPromptTokens,
			model: input.model,
		}) ?? ""
	);
}

function resolveTeamSafeAgent(
	agentToUse: string,
	model: DelegatedModelConfig | undefined,
	ctx: ExecutorContext,
): string {
	const agentKey = getAgentConfigKey(agentToUse);
	if (!model) return agentToUse;

	if (agentKey === "hephaestus" && !isGptModel(model.modelID)) {
		if (ctx.agentOverrides?.hephaestus?.allow_non_gpt_model === true)
			return agentToUse;
		return "sisyphus";
	}

	if (
		agentKey === "sisyphus" &&
		isGptModel(model.modelID) &&
		!isGptNativeSisyphusModel(model.modelID)
	) {
		return "hephaestus";
	}

	return agentToUse;
}

// Strip global `agents.sisyphus-junior.model` override at the team-mode boundary —
// `resolveCategoryExecution` ranks it above category defaults (correct for plain
// `task(category=…)`, wrong here) and would collapse every team member to the same model.
function withoutSisyphusJuniorOverride(ctx: ExecutorContext): ExecutorContext {
	if (ctx.sisyphusJuniorModel === undefined) return ctx;
	return { ...ctx, sisyphusJuniorModel: undefined };
}

export async function resolveMember(
	member: Member,
	ctx: ExecutorContext,
	categoryExamples: string,
	parentAgent?: string,
): Promise<ResolvedMember> {
	try {
		if (member.kind === "category") {
			const execution = await resolveCategoryExecution(
				{
					...createBaseDelegateTaskArgs(member.prompt),
					category: member.category,
					subagent_type: "sisyphus-junior",
				},
				withoutSisyphusJuniorOverride(ctx),
				undefined,
				undefined,
			);

			if (execution.error) {
				throw new Error(execution.error);
			}

			return {
				memberName: member.name,
				agentToUse: execution.agentToUse,
				model: execution.categoryModel,
				fallbackChain: execution.fallbackChain,
				systemContent: resolveSystemContent({
					agentToUse: execution.agentToUse,
					categoryPromptAppend: execution.categoryPromptAppend,
					maxPromptTokens: execution.maxPromptTokens,
					model: execution.categoryModel,
				}),
			};
		}

		const execution = await resolveSubagentExecution(
			{
				...createBaseDelegateTaskArgs(member.prompt ?? ""),
				subagent_type: member.subagent_type,
			},
			ctx,
			parentAgent,
			categoryExamples,
			{
				allowSisyphusJuniorDirect: true,
				allowPrimaryAgentDelegation: true,
			},
		);

		if (execution.error) {
			throw new Error(execution.error);
		}

		const agentToUse = resolveTeamSafeAgent(
			execution.agentToUse,
			execution.categoryModel,
			ctx,
		);

		return {
			memberName: member.name,
			agentToUse,
			model: execution.categoryModel,
			fallbackChain: execution.fallbackChain,
			systemContent: resolveSystemContent({
				agentToUse,
				model: execution.categoryModel,
			}),
			modelIntent: execution.modelIntent,
		};
	} catch (error) {
		throw new TeamMemberResolutionError(
			member.name,
			normalizeResolutionError(error),
		);
	}
}

/**
 * Synthesizes a per-member ExecutorContext clone with the given model
 * string injected into the channel that the underlying resolver consults
 * for that member kind. Subagent members go through `agentOverrides[<type>].model`
 * (read in subagent-resolver.ts:138). Category members go through
 * `userCategories[<category>].model` (read as `explicitCategoryModel` in
 * category-resolver.ts:139). The clone is per-call so concurrent member
 * resolutions don't collide on shared dictionary state.
 */
export function injectMemberModelOverride(
	ctx: ExecutorContext,
	member: Member,
	modelOverride: string,
): ExecutorContext {
	if (member.kind === "subagent_type") {
		// AgentOverrides is a strict-keyed schema (build/sisyphus/atlas/...).
		// We treat it as a string-indexed bag for the synthetic per-member
		// injection, which is safe because subagent-resolver also reads it
		// via a dynamic configKey lookup at subagent-resolver.ts:138 — the
		// resolver tolerates unknown keys (returns undefined for unmatched).
		const agentKey = member.subagent_type;
		const overrides = ctx.agentOverrides as
			| Record<string, Record<string, unknown> | undefined>
			| undefined;
		return {
			...ctx,
			agentOverrides: {
				...(ctx.agentOverrides as
					| Record<string, Record<string, unknown> | undefined>
					| undefined),
				[agentKey]: {
					...(overrides?.[agentKey] ?? {}),
					model: modelOverride,
				},
			} as ExecutorContext["agentOverrides"],
		};
	}
	const categoryKey = member.category;
	return {
		...ctx,
		userCategories: {
			...ctx.userCategories,
			[categoryKey]: {
				...(ctx.userCategories?.[categoryKey] ?? {}),
				model: modelOverride,
			},
		},
	};
}

function delegatedModelConfigToString(model: DelegatedModelConfig): string {
	return `${model.providerID}/${model.modelID}`;
}

/**
 * Selects the appropriate fallback chain for creative-mode round-robin.
 * Subagent-kind members use the agent's own chain. Category-kind members
 * use the category's declared chain from CATEGORY_MODEL_REQUIREMENTS —
 * this respects the user's intent (e.g., "quick" → cheap models,
 * "ultrabrain" → deep-reasoning models). Falls back to sisyphus-junior's
 * chain when the category has no registered fallback chain.
 */
function getCreativeChainForMember(
	member: Member,
): ReadonlyArray<FallbackEntry> {
	if (member.kind === "subagent_type") {
		return AGENT_MODEL_REQUIREMENTS[member.subagent_type]?.fallbackChain ?? [];
	}
	const categoryChain =
		CATEGORY_MODEL_REQUIREMENTS[member.category]?.fallbackChain;
	if (categoryChain && categoryChain.length > 0) {
		return categoryChain;
	}
	return AGENT_MODEL_REQUIREMENTS["sisyphus-junior"]?.fallbackChain ?? [];
}

/**
 * Routes a member through the right model-selection lever based on the
 * team's policy. Always returns `modelIntent: "explicit"` — every team
 * member is a deliberate pick (the auto path is unreachable from team
 * mode by design). Precedence inside the wrapper:
 *
 *   1. per-member `member.model` (TeamSpec field) wins
 *   2. lead bypasses policy and resolves on its own model
 *   3. stable mode + seed available -> inject seed as agent/category override
 *   4. creative mode -> round-robin reachable chain[i % len]
 *   5. otherwise (stable mode without seed) -> fall through to plain resolveMember
 */
export async function resolveMemberWithPolicy(input: {
	member: Member;
	ctx: ExecutorContext;
	policy: MemberSelectionPolicy;
	seed?: StableSeed;
	followerIndex: number;
	isLead: boolean;
	categoryExamples: string;
	parentAgent?: string;
}): Promise<ResolvedMember> {
	const {
		member,
		ctx,
		policy,
		seed,
		followerIndex,
		isLead,
		categoryExamples,
		parentAgent,
	} = input;

	// 1. Per-member explicit override always wins.
	// The literal sentinel "auto" (case-insensitive) means "no override —
	// route through the team's policy / chain just like an unset field".
	// Without this exemption, an LLM-emitted spec containing `model: "auto"`
	// would crash team_create with "Invalid model format" because the
	// string isn't `provider/model` and parseModelString rejects it. This
	// is the bug observed in the team_create logs where the lead burned
	// tokens fixing the spec after a cryptic validation error.
	const memberModelOverride =
		member.model !== undefined &&
		member.model !== "" &&
		member.model.toLowerCase() !== "auto"
			? member.model
			: undefined;
	if (memberModelOverride !== undefined) {
		const ctxWithOverride = injectMemberModelOverride(
			ctx,
			member,
			memberModelOverride,
		);
		const resolved = await resolveMember(
			member,
			ctxWithOverride,
			categoryExamples,
			parentAgent,
		);
		return { ...resolved, modelIntent: TEAM_MEMBER_MODEL_INTENT };
	}

	// 2. Lead resolves on its own — its outcome BECOMES the seed (stable
	//    mode), and in creative mode the lead deliberately keeps its own
	//    model per the user's design decision.
	if (isLead) {
		const resolved = await resolveMember(
			member,
			ctx,
			categoryExamples,
			parentAgent,
		);
		return { ...resolved, modelIntent: TEAM_MEMBER_MODEL_INTENT };
	}

	// 3. Stable mode + seed available — broadcast lead's model.
	if (policy.kind === "stable" && seed) {
		const seedModelString = delegatedModelConfigToString(seed.model);
		const ctxWithSeed = injectMemberModelOverride(ctx, member, seedModelString);
		const resolved = await resolveMember(
			member,
			ctxWithSeed,
			categoryExamples,
			parentAgent,
		);
		return { ...resolved, modelIntent: TEAM_MEMBER_MODEL_INTENT };
	}

	// 4. Creative mode — round-robin chain[i % len], filtered by reachable.
	if (policy.kind === "creative") {
		const chain = getCreativeChainForMember(member);
		const reachable = filterReachableChainEntries(
			chain,
			policy.connectedProviders,
		);
		if (reachable.length === 0) {
			throw new TeamMemberResolutionError(
				member.name,
				new Error(
					`creative mode: no reachable fallback-chain entries for member '${member.name}' (chain length ${chain.length}, connected providers: ${policy.connectedProviders?.join(", ") ?? "<unknown>"})`,
				),
			);
		}
		const entry = pickCreativeChainEntry(reachable, followerIndex);
		if (!entry) {
			throw new TeamMemberResolutionError(
				member.name,
				new Error(`creative mode: empty reachable chain after filter`),
			);
		}
		const provider = pickEntryProvider({
			entry,
			connectedProviders: policy.connectedProviders,
		});
		if (!provider) {
			throw new TeamMemberResolutionError(
				member.name,
				new Error(
					`creative mode: no provider available for chosen entry ${entry.model}`,
				),
			);
		}
		const fullModel = `${provider}/${entry.model}`;
		const ctxWithCreative = injectMemberModelOverride(ctx, member, fullModel);
		const resolved = await resolveMember(
			member,
			ctxWithCreative,
			categoryExamples,
			parentAgent,
		);
		return { ...resolved, modelIntent: TEAM_MEMBER_MODEL_INTENT };
	}

	// 5. Stable mode without a seed (lead resolution failed) — auto.
	return resolveMember(member, ctx, categoryExamples, parentAgent);
}
