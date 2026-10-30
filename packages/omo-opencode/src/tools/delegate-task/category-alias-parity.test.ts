declare const require: (name: string) => unknown
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test") as typeof import("bun:test")
import { LEGACY_CATEGORY_NAME_ALIASES } from "@oh-my-opencode/omo-config-core"
import { resolveCategoryExecution } from "./category-resolver"
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"
import type { ExecutorContext } from "./executor-types"
import type { CategoryResolutionResult } from "./category-resolver"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { parseModelString } from "../../shared/model-string-parser"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { MemberSchema, RuntimeStateSchema } from "@oh-my-opencode/team-core"
import { applyMemberSessionRouting } from "../../features/team-mode/member-session-routing"
import { getRawFallbackModels } from "../../hooks/runtime-fallback/fallback-models"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

const PROMPT_INPUT_SENTINEL = "PROMPT_INPUT_SENTINEL"
const USER_CONFIGURED_MODEL = "openai/gpt-5.5"
const SISYPHUS_JUNIOR_MODEL = "anthropic/claude-sonnet-4-6"
const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"

// Every retired builtin category name must resolve exactly like the canonical name it was renamed to
// (#8516 promised `task(category: "deep")` keeps running, on `deep-low`). The table is the alias map
// itself, so a future rename is covered the day it is added.
const ALIAS_TABLE = Object.entries(LEGACY_CATEGORY_NAME_ALIASES)

describe("retired category alias parity", () => {
	let spies: Array<ReturnType<typeof spyOn>> = []

	beforeEach(() => {
		mock.restore()
		spies = [
			spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null),
			spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null),
			spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(false),
			spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false),
		]
	})

	afterEach(() => {
		for (const spy of spies) spy.mockRestore()
	})

	const argsFor = (category: string) => ({
		category,
		prompt: PROMPT_INPUT_SENTINEL,
		description: "alias parity",
		run_in_background: false,
		load_skills: [],
		blockedBy: undefined,
		enableSkillTools: false,
	})

	const executorContext = (overrides: Partial<ExecutorContext>): ExecutorContext => ({
		client: unsafeTestValue({}),
		manager: unsafeTestValue({}),
		directory: "/tmp/test",
		userCategories: {},
		sisyphusJuniorModel: undefined,
		...overrides,
	})

	const comparable = (result: CategoryResolutionResult) => ({
		actualModel: result.actualModel,
		categoryModel: result.categoryModel,
		categoryPromptAppend: result.categoryPromptAppend,
		fallbackChain: result.fallbackChain,
		modelInfo: result.modelInfo,
		maxPromptTokens: result.maxPromptTokens,
		isUnstableAgent: result.isUnstableAgent,
		agentToUse: result.agentToUse,
		error: result.error,
	})

	for (const [alias, canonical] of ALIAS_TABLE) {
		test(`"${alias}" resolves like "${canonical}" with a user model on the canonical key`, async () => {
			//#given
			// The config loader renames a user `categories.<alias>` key to the canonical one at load time,
			// so the canonical key is the only spelling a resolver ever sees in user config.
			const ctx = () => executorContext({
				userCategories: { [canonical]: { model: USER_CONFIGURED_MODEL } },
				sisyphusJuniorModel: SISYPHUS_JUNIOR_MODEL,
			})

			//#when
			const aliasResult = await resolveCategoryExecution(argsFor(alias), ctx(), undefined, SYSTEM_DEFAULT_MODEL)
			const canonicalResult = await resolveCategoryExecution(argsFor(canonical), ctx(), undefined, SYSTEM_DEFAULT_MODEL)

			//#then
			expect(aliasResult.error).toBeUndefined()
			expect(comparable(aliasResult)).toEqual(comparable(canonicalResult))
			expect(aliasResult.actualModel).toBe(USER_CONFIGURED_MODEL)
		})

		test(`"${alias}" resolves like "${canonical}" on builtin defaults`, async () => {
			//#given
			// Warm the provider cache with the canonical lane's own gate models so the builtin chain really
			// resolves; a cold registry would make both names refuse identically and prove nothing.
			const chain = CATEGORY_MODEL_REQUIREMENTS[canonical]?.fallbackChain ?? []
			const models: Record<string, string[]> = {}
			for (const entry of chain) {
				const parsed = parseModelString(entry.model)
				const providers = entry.providers ?? (parsed ? [parsed.providerID] : [])
				const modelID = parsed?.modelID ?? entry.model
				for (const providerID of providers) {
					models[providerID] = [...(models[providerID] ?? []), modelID]
				}
			}
			spies.push(
				spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
					models,
					connected: Object.keys(models),
					updatedAt: "2026-10-28T00:00:00.000Z",
				}),
				spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(Object.keys(models)),
				spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true),
				spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true),
			)
			const ctx = () => executorContext({})

			//#when
			const aliasResult = await resolveCategoryExecution(argsFor(alias), ctx(), undefined, SYSTEM_DEFAULT_MODEL)
			const canonicalResult = await resolveCategoryExecution(argsFor(canonical), ctx(), undefined, SYSTEM_DEFAULT_MODEL)

			//#then
			expect(aliasResult.error).toBeUndefined()
			expect(comparable(aliasResult)).toEqual(comparable(canonicalResult))
			expect(aliasResult.actualModel).toBeDefined()
		})

		test(`"${alias}" resolves like "${canonical}" with a variant and a fallback chain`, async () => {
			//#given
			const ctx = () => executorContext({
				userCategories: {
					[canonical]: {
						model: USER_CONFIGURED_MODEL,
						variant: "high",
						fallback_models: ["anthropic/claude-opus-4-7", "openai/gpt-5.5(low)"],
					},
				},
				sisyphusJuniorModel: SISYPHUS_JUNIOR_MODEL,
			})

			//#when
			const aliasResult = await resolveCategoryExecution(argsFor(alias), ctx(), undefined, SYSTEM_DEFAULT_MODEL)
			const canonicalResult = await resolveCategoryExecution(argsFor(canonical), ctx(), undefined, SYSTEM_DEFAULT_MODEL)

			//#then
			expect(aliasResult.error).toBeUndefined()
			expect(comparable(aliasResult)).toEqual(comparable(canonicalResult))
			expect(aliasResult.categoryModel?.variant).toBe("high")
		})

		test(`the spawn boundary hands "${alias}" downstream as "${canonical}"`, async () => {
			//#given
			const ctx = unsafeTestValue({ metadata: async () => {} })

			//#when
			const prepared = await prepareDelegateTaskArgs(
				{ category: alias, prompt: PROMPT_INPUT_SENTINEL, run_in_background: false, load_skills: [] },
				ctx,
			)

			//#then
			// Downstream readers (session category registry, runtime fallback, task metadata, logs) read this
			// value directly, so the canonical name has to be set here rather than at each reader.
			expect(prepared.category).toBe(canonical)
		})

		test(`a team member spelled "${alias}" reaches runtime fallback as "${canonical}"`, () => {
			//#given
			// Team mode never goes through the task tool: the member is parsed, launched, stored in runtime
			// state and registered for the session, and runtime fallback then reads categories[<name>].
			const member = MemberSchema.parse({
				kind: "category",
				name: "member-a",
				category: alias,
				prompt: "Do the assigned work.",
			})
			const sessionID = `ses_alias_parity_${canonical}`
			const pluginConfig = unsafeTestValue({
				categories: { [canonical]: { model: USER_CONFIGURED_MODEL, fallback_models: ["anthropic/claude-opus-4-7"] } },
			})

			//#when
			applyMemberSessionRouting(sessionID, unsafeTestValue({ name: "member-a", category: member.category }))
			const fallbackModels = getRawFallbackModels(sessionID, undefined, pluginConfig)

			//#then
			expect(member.category).toBe(canonical)
			expect(SessionCategoryRegistry.get(sessionID)).toBe(canonical)
			expect(fallbackModels).toEqual(["anthropic/claude-opus-4-7"])
			SessionCategoryRegistry.remove(sessionID)
		})

		test(`a team state persisted with "${alias}" resumes as "${canonical}"`, () => {
			//#given
			// A run whose state.json was written before this change still holds the retired name; the value
			// is registered for the session on idle wake and live delivery, so it is canonicalized on read.
			const state = RuntimeStateSchema.parse({
				version: 1,
				teamRunId: "6f1a4c62-0b61-4a5f-9f4a-1a6d8a0d7f21",
				teamName: "alias-parity",
				specSource: "project",
				status: "active",
				createdAt: 1,
				members: [{ name: "member-a", agentType: "general-purpose", category: alias, status: "idle" }],
				bounds: {},
			})
			const sessionID = `ses_alias_parity_state_${canonical}`
			const pluginConfig = unsafeTestValue({
				categories: { [canonical]: { model: USER_CONFIGURED_MODEL, fallback_models: ["anthropic/claude-opus-4-7"] } },
			})

			//#when
			applyMemberSessionRouting(sessionID, unsafeTestValue(state.members[0]))
			const fallbackModels = getRawFallbackModels(sessionID, undefined, pluginConfig)

			//#then
			expect(state.members[0]?.category).toBe(canonical)
			expect(SessionCategoryRegistry.get(sessionID)).toBe(canonical)
			expect(fallbackModels).toEqual(["anthropic/claude-opus-4-7"])
			SessionCategoryRegistry.remove(sessionID)
		})

		test(`an error names "${alias}" when that is what the caller typed`, async () => {
			//#given
			// The boundary canonicalizes before the resolver sees the name, so it carries the typed spelling
			// separately; a disabled canonical lane is the reachable error for a retired name.
			const prepared = await prepareDelegateTaskArgs(
				{ category: alias, prompt: PROMPT_INPUT_SENTINEL, run_in_background: false, load_skills: [] },
				unsafeTestValue({ metadata: async () => {} }),
			)
			const ctx = executorContext({ userCategories: { [canonical]: { disable: true } } })

			//#when
			const result = await resolveCategoryExecution(unsafeTestValue(prepared), ctx, undefined, SYSTEM_DEFAULT_MODEL)

			//#then
			expect(prepared.requestedCategory).toBe(alias)
			expect(result.error).toContain(`Unknown category: "${alias}"`)
			expect(result.error).not.toContain(`Unknown category: "${canonical}"`)
		})
	}
})

