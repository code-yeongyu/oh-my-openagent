import { describe, expect, test } from "bun:test";

import { AGENT_FALLBACK_CHAINS } from "./agents/builtin/fallback-chains";
import { CATEGORY_FALLBACK_CHAINS } from "./category/fallback-chains";

const GLM_53_PROVIDERS = [
	"zai-coding-plan",
	"zhipuai-coding-plan",
	"opencode-go",
];

describe("Senpi GLM 5.3 fallback mirrors", () => {
	test.each(["metis", "momus"])(
		"%s uses the live-supported GLM 5.3 lane",
		(agentName) => {
			const chain = AGENT_FALLBACK_CHAINS[agentName];
			const glmRung = chain?.find(({ model }) => model.startsWith("glm-"));

			expect(glmRung).toEqual({
				providers: GLM_53_PROVIDERS,
				model: "glm-5.3",
			});
		},
	);

	test("visual-engineering mirrors the canonical GLM 5.3 max lane", () => {
		const chain = CATEGORY_FALLBACK_CHAINS["visual-engineering"];
		const glmRung = chain?.find(({ model }) => model.startsWith("glm-"));

		expect(glmRung).toEqual({
			providers: GLM_53_PROVIDERS,
			model: "glm-5.3",
			variant: "max",
		});
	});
});
