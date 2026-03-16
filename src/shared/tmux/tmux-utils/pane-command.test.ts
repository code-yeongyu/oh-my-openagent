import { describe, expect, test } from "bun:test"
import {
	buildDetachedPanePlaceholderCommand,
	buildOpencodeAttachCommand,
} from "./pane-command"

	describe("pane-command", () => {
	test("buildDetachedPanePlaceholderCommand returns non-attach placeholder", () => {
		const command = buildDetachedPanePlaceholderCommand()

		expect(command).toContain("Subagent pane ready")
		expect(command).toContain("sleep 3600")
		expect(command).not.toContain("opencode attach")
	})

	test("buildOpencodeAttachCommand returns attach command", () => {
		const command = buildOpencodeAttachCommand("http://localhost:4096", "ses_child")

		expect(command).toBe(
			"zsh -c 'opencode attach http://localhost:4096 --session ses_child'",
		)
	})
})
