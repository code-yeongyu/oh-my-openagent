import type { RalphLoopOptions, IterationCommitExpectation, RalphLoopState } from "./types"

export type LoopStateController = {
	getState: () => RalphLoopState | null
	clear: () => boolean
	incrementIteration: (expected?: IterationCommitExpectation) => RalphLoopState | null
	setSessionID: (sessionID: string) => RalphLoopState | null
	markVerificationPending: (sessionID: string) => RalphLoopState | null
	setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null
	restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
	clearVerificationState: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
}

export type RalphLoopEventHandlerOptions = {
	directory: string
	apiTimeoutMs: number
	idleSettleMs: number
	getTranscriptPath: (sessionID: string) => string | undefined
	checkSessionExists?: RalphLoopOptions["checkSessionExists"]
	backgroundManager?: RalphLoopOptions["backgroundManager"]
	loopState: LoopStateController
}
