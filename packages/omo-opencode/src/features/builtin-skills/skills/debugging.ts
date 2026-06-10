import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const debuggingSkill: BuiltinSkill = {
	name: "debugging",
	description:
		"MUST USE for any real runtime debugging across ANY language or binary — crashes, silent failures, wrong responses, stuck processes, memory leaks, async misbehavior, unexplained timing, reverse engineering. Runs a hypothesis-driven loop: form ≥3 hypotheses, investigate in parallel, after 2 failed rounds spawn Oracles from orthogonal angles, confirm root cause, lock with a failing test, fix minimally, QA by actually USING the system, scrub artifacts. The actual HOW lives in `references/` — READ THEM. Triggers: 'debug this', 'why is X not working', 'hanging', 'attach a debugger', 'reverse engineer', 'pwndbg', 'gdb', 'lldb', 'node inspect', 'tsx debug', 'pdb', 'dlv', 'delve', 'rust-gdb', 'set a breakpoint', 'context window exploded', 'why is the response empty', 'attach the debugger', 'debug it', 'why is this happening', 'trace this bug', 'reproduce and fix', 'silent failure', 'HTTP 200 but empty', 'why did it stop', 'inspect the binary', 'reverse engineering', 'playwright'.",
	template: loadSharedSkillTemplate("debugging"),
}
