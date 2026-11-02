import { describe, expect, test } from "bun:test"

import { runTmuxCommand as runTmuxCommandFromCore } from "@oh-my-opencode/tmux-core"

import { runTmuxCommand } from "./runner"

/**
 * This module only re-exports `@oh-my-opencode/tmux-core`, so its behaviour is covered once, in
 * packages/tmux-core/src/runner.test.ts. What this package owns is the re-export itself: a copy of
 * the behavioural suite here only duplicated the host-shell seam of #11259 in a second file.
 */
describe("shared/tmux/runner", () => {
	test("#given the shared tmux runner module #when runTmuxCommand is imported #then it is tmux-core's implementation", () => {
		// then
		expect(runTmuxCommand).toBe(runTmuxCommandFromCore)
	})
})
