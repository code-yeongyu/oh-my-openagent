import { describe, expect, test } from "bun:test";

import {
	createSisyphusAgent,
	resolveSisyphusPromptFamily,
} from "./sisyphus-agent-factory";
import {
	buildSisyphusJuniorPrompt,
	getSisyphusJuniorPromptSource,
} from "./sisyphus-junior";

describe("GLM 5.3 prompt routing", () => {
	test("Sisyphus uses the GLM 5.3 prompt identity", () => {
		const model = "opencode-go/glm-5.3";
		const agent = createSisyphusAgent(model);

		expect(resolveSisyphusPromptFamily(model)).toBe("glm-5-3");
		expect(agent.prompt).toContain("running on GLM 5.3");
		expect(agent.prompt).toContain("<glm_53_calibration>");
	});

	test("Sisyphus-Junior uses the GLM 5.3 prompt identity", () => {
		const model = "zai-coding-plan/glm-5.3";
		const prompt = buildSisyphusJuniorPrompt(model, false);

		expect(getSisyphusJuniorPromptSource(model)).toBe("glm-5-3");
		expect(prompt).toContain("running on GLM 5.3");
		expect(prompt).toContain("<glm_5_3_calibration>");
	});

	test("older GLM family IDs receive the current GLM prompt", () => {
		const model = "opencode-go/glm-5.2";

		expect(resolveSisyphusPromptFamily(model)).toBe("glm-5-3");
		expect(getSisyphusJuniorPromptSource(model)).toBe("glm-5-3");
	});
});
