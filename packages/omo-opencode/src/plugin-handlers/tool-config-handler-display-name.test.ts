import { describe, expect, it } from "bun:test";
import type { OhMyOpenCodeConfig } from "../config";
import { applyToolConfig } from "./tool-config-handler";

function createDisplayNameParams(displayName: string): {
	readonly config: Record<string, unknown>;
	readonly pluginConfig: OhMyOpenCodeConfig;
	readonly agentResult: Record<string, unknown>;
} {
	return {
		config: { tools: {}, permission: {} },
		pluginConfig: {
			agents: {
				prometheus: { displayName },
			},
		} as OhMyOpenCodeConfig,
		agentResult: {
			[displayName]: { permission: {} },
		},
	};
}

describe("applyToolConfig with custom display names", () => {
	it("#given prometheus has custom displayName #when tool config applies #then bash remains denied", () => {
		// given
		const displayName = "Prometheus Custom Planner";
		const params = createDisplayNameParams(displayName);

		// when
		applyToolConfig(params);

		// then
		const agent = params.agentResult[displayName] as {
			permission: Record<string, unknown>;
		};
		expect(agent.permission.bash).toBe("deny");
		expect(agent.permission.interactive_bash).toBe("deny");
		expect(agent.permission.task).toBe("allow");
	});
});
