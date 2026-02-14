import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { RalphLoopOptions, RalphLoopState } from "./types"
import { HOOK_NAME } from "./constants"
import {
	detectAuditCycleStagnation,
	evaluateAuditCompletionLock,
	detectCompletionInSessionMessages,
	detectCompletionInTranscript,
	getLatestNonUserTranscriptText,
} from "./completion-promise-detector"
import { buildContinuationPrompt, buildTimeoutSummaryPrompt } from "./continuation-prompt-builder"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import {
	appendAuditLedgerEntry,
	extractCycleEvidenceSummary,
	summarizeAuditCycleEvidence,
	updateAuditCheckpointWithCycle,
} from "./audit-ledger"

type SessionRecovery = {
	isRecovering: (sessionID: string) => boolean
	markRecovering: (sessionID: string) => void
	clear: (sessionID: string) => void
}
type LoopStateController = { getState: () => RalphLoopState | null; clear: () => boolean; incrementIteration: () => RalphLoopState | null }
type RalphLoopEventHandlerOptions = { directory: string; apiTimeoutMs: number; getTranscriptPath: (sessionID: string) => string | undefined; checkSessionExists?: RalphLoopOptions["checkSessionExists"]; sessionRecovery: SessionRecovery; loopState: LoopStateController }

function formatRemainingTime(deadlineAt?: string): string | null {
  if (!deadlineAt) return null
  const deadlineMs = Date.parse(deadlineAt)
  if (!Number.isFinite(deadlineMs)) return null
  const remainingMs = Math.max(0, deadlineMs - Date.now())
  const totalMinutes = Math.floor(remainingMs / (60 * 1000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.floor(remainingMs / 1000)}s`
}

export function createRalphLoopEventHandler(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
) {
	return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
		const props = event.properties as Record<string, unknown> | undefined

		if (event.type === "session.idle") {
			const sessionID = props?.sessionID as string | undefined
			if (!sessionID) return

			if (options.sessionRecovery.isRecovering(sessionID)) {
				log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
				return
			}

			const state = options.loopState.getState()
			if (!state || !state.active) {
				return
			}

			if (state.session_id && state.session_id !== sessionID) {
				if (options.checkSessionExists) {
					try {
						const exists = await options.checkSessionExists(state.session_id)
						if (!exists) {
							options.loopState.clear()
							log(`[${HOOK_NAME}] Cleared orphaned state from deleted session`, {
								orphanedSessionId: state.session_id,
								currentSessionId: sessionID,
							})
							return
						}
					} catch (err) {
						log(`[${HOOK_NAME}] Failed to check session existence`, {
							sessionId: state.session_id,
							error: String(err),
						})
					}
				}
				return
			}

			const completionDetectionEnabled = state.completion_detection_enabled !== false
			const transcriptPath = options.getTranscriptPath(sessionID)
      let forceStrategySwitch = false
      let objectiveCapViolation = false
      let regressionGateMissing = false
      let allowAutoFocusProgression = false
      const latestAuditText =
        state.mode === "audit-loop"
          ? getLatestNonUserTranscriptText(transcriptPath)
          : null
      if (state.mode === "audit-loop") {
        const summary = extractCycleEvidenceSummary(latestAuditText)
        const policySummary = summarizeAuditCycleEvidence(latestAuditText)
        const policyUpdate = updateAuditCheckpointWithCycle(options.directory, policySummary)
        forceStrategySwitch = policyUpdate.forceStrategySwitch
        objectiveCapViolation = policyUpdate.objectiveCapViolation
        regressionGateMissing = policyUpdate.regressionGateMissing
        allowAutoFocusProgression = policyUpdate.allowAutoFocusProgression
        appendAuditLedgerEntry(options.directory, {
          timestamp: new Date().toISOString(),
          session_id: sessionID,
          iteration: state.iteration,
          mode: state.mode,
          event: "cycle_observed",
          ...summary,
          stagnation_detected: detectAuditCycleStagnation(transcriptPath),
        })
        if (policyUpdate.lockedFilesAdded.length > 0) {
          await ctx.client.tui
            .showToast({
              body: {
                title: "Audit File Lock Applied",
                message: `Locked saturated files: ${policyUpdate.lockedFilesAdded.join(", ")}`,
                variant: "info",
                duration: 4000,
              },
            })
            .catch(() => {})
        }
      }
			const completionViaTranscript = completionDetectionEnabled
				? detectCompletionInTranscript(transcriptPath, state.completion_promise)
				: false
			const completionViaApi =
				!completionDetectionEnabled || completionViaTranscript
					? false
					: await detectCompletionInSessionMessages(ctx, {
							sessionID,
							promise: state.completion_promise,
							apiTimeoutMs: options.apiTimeoutMs,
							directory: options.directory,
						})

			if (completionViaTranscript || completionViaApi) {
        if (state.mode === "audit-loop") {
          const completionLock = evaluateAuditCompletionLock(transcriptPath)
          if (!completionLock.passed) {
            appendAuditLedgerEntry(options.directory, {
              timestamp: new Date().toISOString(),
              session_id: sessionID,
              iteration: state.iteration,
              mode: state.mode,
              event: "completion_blocked",
              missing_gates: completionLock.missing,
            })
            log(`[${HOOK_NAME}] Audit completion blocked: missing gates`, {
              sessionID,
              iteration: state.iteration,
              missingGates: completionLock.missing,
            })
            await ctx.client.tui
              .showToast({
                body: {
                  title: "Audit Completion Blocked",
                  message: `Missing gates: ${completionLock.missing.join(", ")}`,
                  variant: "warning",
                  duration: 5000,
                },
              })
              .catch(() => {})
          } else {
            appendAuditLedgerEntry(options.directory, {
              timestamp: new Date().toISOString(),
              session_id: sessionID,
              iteration: state.iteration,
              mode: state.mode,
              event: "completed",
            })
            log(`[${HOOK_NAME}] Completion detected!`, {
              sessionID,
              iteration: state.iteration,
              promise: state.completion_promise,
              detectedVia: completionViaTranscript
                ? "transcript_file"
                : "session_messages_api",
            })
            options.loopState.clear()

            const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Ralph Loop Complete!"
            const message = state.ultrawork ? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)` : `Task completed after ${state.iteration} iteration(s)`
            await ctx.client.tui.showToast({ body: { title, message, variant: "success", duration: 5000 } }).catch(() => {})
            return
          }
        } else {
				log(`[${HOOK_NAME}] Completion detected!`, {
					sessionID,
					iteration: state.iteration,
					promise: state.completion_promise,
					detectedVia: completionViaTranscript
						? "transcript_file"
						: "session_messages_api",
				})
				options.loopState.clear()

				const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Ralph Loop Complete!"
				const message = state.ultrawork ? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)` : `Task completed after ${state.iteration} iteration(s)`
				await ctx.client.tui.showToast({ body: { title, message, variant: "success", duration: 5000 } }).catch(() => {})
				return
        }
			}

      const deadlineMs = state.deadline_at ? Date.parse(state.deadline_at) : NaN
      const isTimedOut = Number.isFinite(deadlineMs) && Date.now() >= deadlineMs
      if (isTimedOut) {
        log(`[${HOOK_NAME}] Max duration reached`, {
          sessionID,
          iteration: state.iteration,
          deadlineAt: state.deadline_at,
          mode: state.mode,
        })
        if (state.mode === "audit-loop") {
          appendAuditLedgerEntry(options.directory, {
            timestamp: new Date().toISOString(),
            session_id: sessionID,
            iteration: state.iteration,
            mode: state.mode,
            event: "timeout",
          })
        }
        options.loopState.clear()

        await ctx.client.tui
          .showToast({
            body: {
              title: "Ralph Loop Timed Out",
              message: "Max duration reached. Stopping loop and generating final summary.",
              variant: "warning",
              duration: 5000,
            },
          })
          .catch(() => {})

        try {
          await injectContinuationPrompt(ctx, {
            sessionID,
            prompt: buildTimeoutSummaryPrompt(state),
            directory: options.directory,
            apiTimeoutMs: options.apiTimeoutMs,
          })
        } catch (err) {
          log(`[${HOOK_NAME}] Failed to inject timeout summary`, {
            sessionID,
            error: String(err),
          })
        }
        return
      }

			if (state.iteration >= state.max_iterations) {
				log(`[${HOOK_NAME}] Max iterations reached`, {
					sessionID,
					iteration: state.iteration,
					max: state.max_iterations,
				})
        if (state.mode === "audit-loop") {
          appendAuditLedgerEntry(options.directory, {
            timestamp: new Date().toISOString(),
            session_id: sessionID,
            iteration: state.iteration,
            mode: state.mode,
            event: "max_iterations",
          })
        }
				options.loopState.clear()

				await ctx.client.tui
					.showToast({
						body: { title: "Ralph Loop Stopped", message: `Max iterations (${state.max_iterations}) reached without completion`, variant: "warning", duration: 5000 },
					})
					.catch(() => {})
				return
			}

			const newState = options.loopState.incrementIteration()
			if (!newState) {
				log(`[${HOOK_NAME}] Failed to increment iteration`, { sessionID })
				return
			}

			log(`[${HOOK_NAME}] Continuing loop`, {
				sessionID,
				iteration: newState.iteration,
				max: newState.max_iterations,
			})

      const remainingTime = formatRemainingTime(newState.deadline_at)
      const isAuditLoop = newState.mode === "audit-loop"
      const heartbeatTitle = isAuditLoop ? "Audit Loop Active" : "Ralph Loop"
      const heartbeatMessage = isAuditLoop
        ? `Iteration ${newState.iteration}/${newState.max_iterations} | Time left: ${remainingTime ?? "N/A"}`
        : `Iteration ${newState.iteration}/${newState.max_iterations}`

			await ctx.client.tui
				.showToast({
					body: {
						title: heartbeatTitle,
						message: heartbeatMessage,
						variant: "info",
						duration: isAuditLoop ? 3500 : 2000,
					},
				})
				.catch(() => {})

			try {
        const isStagnant =
          newState.mode === "audit-loop"
            ? detectAuditCycleStagnation(transcriptPath)
            : false
        const alertBlocks: string[] = []
        if (allowAutoFocusProgression) {
          alertBlocks.push(`AUTO FOCUS PROGRESSION:
- Previous focus screen is marked SCREEN COMPLETE and passed Validation + Regression gates.
- In this cycle, switch once to the next highest-impact screen immediately.
- Do not wait for user confirmation and do not require BLOCKER REPORT for this completion-based switch.`)
        }
        if (isStagnant) {
          alertBlocks.push(`STAGNATION ALERT:
- Last two cycles look repetitive.
- Change strategy now: increase parallel research agents to at least 4 for the next cycle.
- Deliver materially different structural edits before ending the cycle.`)
        }
        if (forceStrategySwitch) {
          alertBlocks.push(`ROLLBACK TRIGGER:
- Validation failed in consecutive cycles.
- Revert the current risky strategy and apply a materially different refactor route in this cycle.`)
        }
        if (regressionGateMissing) {
          alertBlocks.push(`REGRESSION GATE VIOLATION:
- Missing Regression Scan PASS evidence in the previous cycle.
- Run and report regression scan before any new implementation work.`)
        }
        if (objectiveCapViolation) {
          alertBlocks.push(`OBJECTIVE CAP VIOLATION:
- Next-Cycle Targets exceeded 3 items.
- Reduce to top 3 objectives before proceeding.`)
        }

        const continuationPrompt = alertBlocks.length > 0
          ? `${buildContinuationPrompt(newState)}

${alertBlocks.join("\n\n")}`
          : buildContinuationPrompt(newState)
				await injectContinuationPrompt(ctx, {
					sessionID,
					prompt: continuationPrompt,
					directory: options.directory,
					apiTimeoutMs: options.apiTimeoutMs,
				})
			} catch (err) {
				log(`[${HOOK_NAME}] Failed to inject continuation`, {
					sessionID,
					error: String(err),
				})
			}
			return
		}

		if (event.type === "session.deleted") {
			const sessionInfo = props?.info as { id?: string } | undefined
			if (!sessionInfo?.id) return
			const state = options.loopState.getState()
			if (state?.session_id === sessionInfo.id) {
				options.loopState.clear()
				log(`[${HOOK_NAME}] Session deleted, loop cleared`, { sessionID: sessionInfo.id })
			}
			options.sessionRecovery.clear(sessionInfo.id)
			return
		}

		if (event.type === "session.error") {
			const sessionID = props?.sessionID as string | undefined
			const error = props?.error as { name?: string } | undefined

			if (error?.name === "MessageAbortedError") {
				if (sessionID) {
					const state = options.loopState.getState()
					if (state?.session_id === sessionID) {
						if (state.mode === "audit-loop") {
              appendAuditLedgerEntry(options.directory, {
                timestamp: new Date().toISOString(),
                session_id: sessionID,
                iteration: state.iteration,
                mode: state.mode,
                event: "aborted",
              })
							log(`[${HOOK_NAME}] MessageAbortedError ignored for audit-loop`, {
								sessionID,
								iteration: state.iteration,
							})
						} else {
							options.loopState.clear()
							log(`[${HOOK_NAME}] User aborted, loop cleared`, { sessionID })
						}
					}
					options.sessionRecovery.clear(sessionID)
				}
				return
			}

			if (sessionID) {
				options.sessionRecovery.markRecovering(sessionID)
			}
		}
	}
}
