import { describe, expect, test } from "bun:test"

import {
	parseModelRoute,
	parseModelRouteWithDiagnostics,
	parseModelString,
} from "./model-string-parser"

describe("model string parser", () => {
	test("#given pipe providers and nested gateway model #when parsed #then provider order, model, and variant are preserved", () => {
		// #given
		const model = "omniRoute|9router/openai/gpt-5.5(high)"

		// #when
		const route = parseModelRoute(model)
		const legacy = parseModelString(model)

		// #then
		expect(route).toEqual({
			providerID: "omniRoute",
			providers: ["omniRoute", "9router"],
			modelID: "openai/gpt-5.5",
			variant: "high",
		})
		expect(legacy).toEqual({
			providerID: "omniRoute",
			modelID: "openai/gpt-5.5",
			variant: "high",
		})
	})

	test("#given a malformed pipe provider list #when parsed with diagnostics #then an actionable error is returned", () => {
		// #given
		const model = "omniRoute| /openai/gpt-5.5"

		// #when
		const result = parseModelRouteWithDiagnostics(model)

		// #then
		expect(result).toEqual({
			kind: "error",
			error: {
				kind: "empty-provider-in-pipe",
				input: model,
				message:
					"Model route provider list contains an empty provider before '/'. Use 'provider1|provider2/model'.",
			},
		})
		expect(parseModelRoute(model)).toBeUndefined()
	})

	test("#given a gateway-routed model #when parsed #then only the gateway is treated as provider", () => {
		// #given
		const model = "vercel/openai/gpt-5.5"

		// #when
		const route = parseModelRoute(model)

		// #then
		expect(route).toEqual({
			providerID: "vercel",
			providers: ["vercel"],
			modelID: "openai/gpt-5.5",
		})
	})
})
