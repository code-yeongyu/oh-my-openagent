import { describe, expect, test } from "bun:test"
import {
	AGENT_MODEL_REQUIREMENTS,
	CATEGORY_MODEL_REQUIREMENTS,
} from "../model-requirements"
import { MODEL_REGISTRY } from "./registry"

const UNSTABLE_MODELS = [
	"gemini-3.1-pro",
	"gemini-3-flash",
	"kimi-k2.5",
	"minimax-m2.5-free",
] as const

function getExpectedProvidersByModel(): Map<string, string[]> {
	const providersByModel = new Map<string, Set<string>>()
	const requirements = [AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS]

	for (const requirementGroup of requirements) {
		for (const requirement of Object.values(requirementGroup)) {
			for (const entry of requirement.fallbackChain) {
				const providers = providersByModel.get(entry.model) ?? new Set<string>()

				for (const provider of entry.providers) {
					providers.add(provider)
				}

				providersByModel.set(entry.model, providers)
			}
		}
	}

	return new Map(
		[...providersByModel.entries()].map(([model, providers]) => [model, [...providers].sort()]),
	)
}

describe("MODEL_REGISTRY", () => {
	describe("#given agent fallback chains", () => {
		test("#when checking registry entries #then every agent fallback model exists", () => {
			// given
			const agentModels = new Set(
				Object.values(AGENT_MODEL_REQUIREMENTS).flatMap((requirement) =>
					requirement.fallbackChain.map((entry) => entry.model),
				),
			)

			// when
			const missingModels = [...agentModels].filter((model) => !(model in MODEL_REGISTRY))

			// then
			expect(missingModels).toEqual([])
		})
	})

	describe("#given registry model names", () => {
		test("#when validating registry keys #then all names are bare model ids", () => {
			// given
			const modelNames = Object.keys(MODEL_REGISTRY)

			// when
			const prefixedModels = modelNames.filter((modelName) => modelName.includes("/"))

			// then
			expect(prefixedModels).toEqual([])
		})
	})

	describe("#given unstable model families", () => {
		test("#when reading unstable entries #then unstable models are explicitly marked", () => {
			// given
			const unstableEntries = UNSTABLE_MODELS.map((model) => MODEL_REGISTRY[model])

			// when
			const missingFlags = unstableEntries.filter((entry) => entry?.isUnstable !== true)

			// then
			expect(missingFlags).toEqual([])
		})
	})

	describe("#given current fallback-chain provider data", () => {
		test("#when comparing registry providers #then provider arrays match current model requirements", () => {
			// given
			const expectedProvidersByModel = getExpectedProvidersByModel()

			// when
			const mismatches = [...expectedProvidersByModel.entries()].filter(([model, providers]) => {
				const registryProviders = [...(MODEL_REGISTRY[model]?.providers ?? [])].sort()

				return JSON.stringify(registryProviders) !== JSON.stringify(providers)
			})

			// then
			expect(mismatches).toEqual([])
		})
	})
})
