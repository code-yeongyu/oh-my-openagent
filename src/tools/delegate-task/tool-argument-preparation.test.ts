/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"
import type { ToolContextWithMetadata } from "./types"

function createToolContext(): ToolContextWithMetadata {
	return {
		sessionID: "ses_test",
		messageID: "msg_test",
		agent: "sisyphus",
		abort: new AbortController().signal,
	}
}

describe("prepareDelegateTaskArgs", () => {
	test("preserves runtime model and variant arguments", async () => {
		//#given
		const args = {
			category: "deep",
			model: "openai/gpt-5.5",
			variant: "xhigh",
			prompt: "Implement the thing",
			run_in_background: false,
			load_skills: [],
		}

		//#when
		const result = await prepareDelegateTaskArgs(args, createToolContext())

		//#then
		expect(result.model).toBe("openai/gpt-5.5")
		expect(result.variant).toBe("xhigh")
		expect(args.model).toBe("openai/gpt-5.5")
		expect(args.variant).toBe("xhigh")
	})
})
