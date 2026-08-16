import { describe, expect, test } from "bun:test";

import { AGENT_MODEL_REQUIREMENTS } from "./agent-model-requirements";
import { CATEGORY_MODEL_REQUIREMENTS } from "./category-model-requirements";
import { getModelCapabilities } from "./model-capabilities";

const GLM_53_PROVIDERS = [
	"zai-coding-plan",
	"zhipuai-coding-plan",
	"opencode-go",
];

describe("GLM 5.3 routing contracts", () => {
	test.each(["sisyphus", "oracle", "momus"])(
		"%s uses the live-supported GLM 5.3 provider lane",
		(agentName) => {
			const chain = AGENT_MODEL_REQUIREMENTS[agentName]?.fallbackChain;
			const glmRung = chain?.find(({ model }) => model.startsWith("glm-"));

			expect(glmRung).toEqual({
				providers: GLM_53_PROVIDERS,
				model: "glm-5.3",
			});
		},
	);

	test("visual-engineering uses GLM 5.3 max", () => {
		const chain =
			CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]?.fallbackChain;
		const glmRung = chain?.find(({ model }) => model.startsWith("glm-"));

		expect(glmRung).toEqual({
			providers: GLM_53_PROVIDERS,
			model: "glm-5.3",
			variant: "max",
		});
	});

	test("GLM 5.3 receives the GLM family capability contract", () => {
		const capabilities = getModelCapabilities({
			providerID: "opencode-go",
			modelID: "glm-5.3",
		});

		expect(capabilities).toMatchObject({
			canonicalModelID: "glm-5.3",
			family: "glm",
			variants: ["low", "medium", "high", "max"],
			reasoningEfforts: ["high", "max"],
		});
	});
});
