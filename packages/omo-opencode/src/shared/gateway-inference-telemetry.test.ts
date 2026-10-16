const { describe, expect, test } = require("bun:test");

import {
	formatGatewayTelemetryLine,
	preferGatewayInferenceTelemetry,
} from "./gateway-inference-telemetry";

describe("preferGatewayInferenceTelemetry", () => {
	describe("#given realistic OpenCode AssistantMessage with no gateway fields", () => {
		test("#when telemetry extracted #then returns empty object", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					role: "assistant",
					modelID: "claude-sonnet-4",
					providerID: "anthropic",
					cost: 0.15,
					tokens: {
						input: 1000,
						output: 500,
						reasoning: 0,
						cache: { read: 0, write: 0 },
					},
				},
			});

			expect(telemetry).toEqual({});
		});

		test("#when formatted #then returns empty string", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					cost: 0.15,
					modelID: "gpt-4o",
				},
			});

			expect(formatGatewayTelemetryLine(telemetry)).toBe("");
		});
	});

	describe("#given gateway-shaped payload with usage.tokens_per_second", () => {
		test("#when telemetry extracted #then returns gateway fields", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					cost: 9.99,
					modelID: "requested-combo",
					usage: {
						cost: 0.0123,
						tokens_per_second: 80.5,
						model: "winner-model",
					},
				},
			});

			expect(telemetry).toEqual({
				costUsd: 0.0123,
				tokensPerSecond: 80.5,
				model: "winner-model",
			});
		});

		test("#when formatted #then renders with rounded numbers", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.0123,
						tokens_per_second: 80.5,
						model: "winner-model",
					},
				},
			});

			expect(formatGatewayTelemetryLine(telemetry)).toBe(
				"cost $0.0123 · tok/s 80.5 · model winner-model",
			);
		});

		test("#when tokensPerSecond field uses camelCase #then reads it", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.05,
						tokensPerSecond: 120.7,
						model: "gpt-4o",
					},
				},
			});

			expect(telemetry.tokensPerSecond).toBe(120.7);
		});
	});

	describe("#given gateway fields in message part metadata", () => {
		test("#when usage in part.metadata.usage #then extracts gateway fields", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					cost: 0.1,
					modelID: "local-model",
				},
				parts: [
					{ type: "text", text: "response" },
					{
						type: "text",
						text: "more",
						metadata: {
							usage: {
								cost: 0.025,
								tokens_per_second: 95.3,
								model: "gateway-model",
							},
						},
					},
				],
			});

			expect(telemetry).toEqual({
				costUsd: 0.025,
				tokensPerSecond: 95.3,
				model: "gateway-model",
			});
		});

		test("#when usage in part.metadata.omniroute #then extracts gateway fields", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {},
				parts: [
					{
						metadata: {
							omniroute: {
								tokens_per_second: 110.0,
								cost: 0.03,
							},
						},
					},
				],
			});

			expect(telemetry.tokensPerSecond).toBe(110.0);
			expect(telemetry.costUsd).toBe(0.03);
		});

		test("#when usage in part.metadata.gateway #then extracts gateway fields", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				parts: [
					{
						metadata: {
							gateway: {
								tokens_per_second: 88.2,
							},
						},
					},
				],
			});

			expect(telemetry.tokensPerSecond).toBe(88.2);
		});
	});

	describe("#given rounding edge cases", () => {
		test("#when cost has floating point precision errors #then rounds to 4 decimals", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.30000000000000004,
						tokens_per_second: 75.5,
					},
				},
			});

			expect(formatGatewayTelemetryLine(telemetry)).toBe(
				"cost $0.3000 · tok/s 75.5",
			);
		});

		test("#when cost is very small #then does not render as scientific notation", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.0000001,
						tokens_per_second: 100.0,
					},
				},
			});

			expect(formatGatewayTelemetryLine(telemetry)).toBe(
				"cost $0.0000 · tok/s 100.0",
			);
		});

		test("#when tok/s has decimal #then rounds to 1 decimal", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						tokens_per_second: 123.456789,
					},
				},
			});

			expect(formatGatewayTelemetryLine(telemetry)).toContain("tok/s 123.5");
		});
	});

	describe("#given invalid or missing values", () => {
		test("#when cost is NaN #then omits cost field", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: NaN,
						tokens_per_second: 100,
					},
				},
			});

			expect(telemetry.costUsd).toBeUndefined();
			expect(formatGatewayTelemetryLine(telemetry)).toBe(
				"cost n/a · tok/s 100.0",
			);
		});

		test("#when cost is Infinity #then omits cost field", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: Infinity,
						tokens_per_second: 50,
					},
				},
			});

			expect(telemetry.costUsd).toBeUndefined();
			expect(formatGatewayTelemetryLine(telemetry)).toBe(
				"cost n/a · tok/s 50.0",
			);
		});

		test("#when tokens_per_second is NaN #then returns empty", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.01,
						tokens_per_second: NaN,
					},
				},
			});

			expect(telemetry).toEqual({});
			expect(formatGatewayTelemetryLine(telemetry)).toBe("");
		});

		test("#when tokens_per_second is zero #then returns empty", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.01,
						tokens_per_second: 0,
					},
				},
			});

			expect(telemetry).toEqual({});
		});

		test("#when tokens_per_second is negative #then returns empty", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						cost: 0.01,
						tokens_per_second: -50,
					},
				},
			});

			expect(telemetry).toEqual({});
		});

		test("#when model is empty string #then omits model", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					usage: {
						tokens_per_second: 100,
						model: "  ",
					},
				},
			});

			expect(telemetry.model).toBeUndefined();
			expect(formatGatewayTelemetryLine(telemetry)).toBe(
				"cost n/a · tok/s 100.0",
			);
		});
	});

	describe("#given usage object exists but lacks tokens_per_second", () => {
		test("#when only other fields present #then returns empty", () => {
			const telemetry = preferGatewayInferenceTelemetry({
				info: {
					cost: 1.5,
					modelID: "local",
					usage: {
						completion_tokens: 200,
						latency_ms: 2000,
					},
				},
			});

			expect(telemetry).toEqual({});
			expect(formatGatewayTelemetryLine(telemetry)).toBe("");
		});
	});
});
