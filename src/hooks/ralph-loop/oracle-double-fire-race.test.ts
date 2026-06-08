import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRalphLoopHook } from "./index"
import { clearState, writeState } from "./storage"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

// Regression lock for Race A: Oracle verification fires twice during ULW loop.
//
// Race A reproduction sequence:
//   1. ULW loop detects <promise>DONE</promise>.
//   2. handleDetectedCompletion → markVerificationPending() flips
//      state.verification_pending=true, clears verification_session_id.
//   3. Verification prompt injected into parent session (prompt #1).
//   4. Model calls task(subagent_type="oracle"). tool-execute-before.ts:147-159
//      writes verification_attempt_id to state (Oracle dispatch in-flight).
//      verification_session_id is NOT YET stored: tool-execute-after.ts:127-130
//      only writes it once the sync Oracle task returns.
//   5. parent session.idle fires before tool-execute-after.ts has run
//      (e.g. via message.part.updated → idle, background activity, or a stale
//      idle that survives the inFlightSessions guard).
//   6. ralph-loop-event-handler.ts:348-366 sees state.verification_pending=true,
//      verificationSessionID=undefined, matchesParentSession=true.
//   7. pending-verification-handler.ts:116-149 attempts recovery via
//      detectOracleVerificationFromParentSession(). Parent messages have no
//      verification evidence yet because Oracle is still running.
//   8. Falls through to handleFailedVerification() (line 140).
//   9. handleFailedVerification injects "Verification failed" prompt (#2),
//      clears verification_pending, increments iteration → DUPLICATE ORACLE.
//
// The discriminator the fix must use: verification_attempt_id is set but
// verification_session_id is not. That state means tool-execute-before has
// stamped a dispatch and the Oracle is mid-execution. The handler must wait
// instead of declaring failure.
describe("ulw-loop oracle double-fire race (Race A)", () => {
	const testDir = join(tmpdir(), `oracle-double-fire-race-${Date.now()}`)
	let promptCalls: Array<{ sessionID: string; text: string }>
	let toastCalls: Array<{ title: string; message: string; variant: string }>
	let abortCalls: Array<{ id: string }>
	let parentTranscriptPath: string
	let oracleTranscriptPath: string

	function createMockPluginInput() {
		return unsafeTestValue<Parameters<typeof createRalphLoopHook>[0]>({
			client: {
				session: {
					promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
						promptCalls.push({
							sessionID: opts.path.id,
							text: opts.body.parts[0].text,
						})
						return {}
					},
					messages: async () => ({ data: [] }),
					abort: async (opts: { path: { id: string } }) => {
						abortCalls.push({ id: opts.path.id })
						return {}
					},
				},
				tui: {
					showToast: async (opts: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(opts.body)
						return {}
					},
				},
			},
			directory: testDir,
		})
	}

	beforeEach(() => {
		promptCalls = []
		toastCalls = []
		abortCalls = []
		parentTranscriptPath = join(testDir, "transcript-parent.jsonl")
		oracleTranscriptPath = join(testDir, "transcript-oracle.jsonl")

		if (!existsSync(testDir)) {
			mkdirSync(testDir, { recursive: true })
		}

		clearState(testDir)
	})

	afterEach(() => {
		clearState(testDir)
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
	})

	test("#given oracle dispatch is in-flight with verification_attempt_id set but verification_session_id undefined #when parent session.idle fires before tool-execute-after stores the oracle session id #then handleFailedVerification must NOT fire prematurely", async () => {
		// given: ULW loop reaches DONE, enters verification_pending state
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)
		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		// sanity: verification phase started, exactly one verification prompt injected
		const stateAfterDone = hook.getState()
		expect(stateAfterDone?.verification_pending).toBe(true)
		expect(stateAfterDone?.verification_session_id).toBeUndefined()
		expect(promptCalls).toHaveLength(1)

		// simulate Oracle dispatch in-flight:
		// tool-execute-before.ts:147-159 has stamped verification_attempt_id
		// but tool-execute-after.ts:127-130 has NOT yet stored verification_session_id
		// because the sync Oracle subagent is still running.
		writeState(testDir, {
			...stateAfterDone!,
			verification_attempt_id: "attempt-uuid-12345",
			verification_session_id: undefined,
		})

		// when: a second session.idle fires on the parent while Oracle is mid-execution
		// (real-world triggers: stale idle survives inFlightSessions guard, message.part.updated
		// loop, background activity in parent, or runtime fallback retry cleanup).
		await hook.event({ event: { type: "message.part.updated", properties: { sessionID: "session-123" } } })
		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		// then: handleFailedVerification must NOT have fired.
		// No duplicate "Verification failed" prompt should have been injected.
		// verification_pending stays true, verification_attempt_id is preserved,
		// iteration is NOT incremented.
		expect(promptCalls).toHaveLength(1)
		expect(promptCalls.every((call) => !call.text.includes("Verification failed"))).toBe(true)

		const stateAfterRace = hook.getState()
		expect(stateAfterRace?.verification_pending).toBe(true)
		expect(stateAfterRace?.verification_attempt_id).toBe("attempt-uuid-12345")
		expect(stateAfterRace?.iteration).toBe(1)
	})
})
