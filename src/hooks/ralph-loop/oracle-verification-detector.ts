import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"

export interface OracleVerificationEvidence {
	agent: string
	promise: string
	sessionID?: string
}

const AGENT_LINE_PATTERN = /^Agent:[ \t]*(\S+)$/im
const PROMISE_TAG_PATTERN = /<promise>[ \t]*(\S+?)[ \t]*<\/promise>/is
const TASK_METADATA_PATTERN = /<task_metadata>[ \t]*([\s\S]*?)[ \t]*<\/task_metadata>/is
const SESSION_ID_LINE_PATTERN = /^session_id:[ \t]*(\S+)$/im

export function parseOracleVerificationEvidence(text: string): OracleVerificationEvidence | undefined {
	const trimmedText = text.trim()
	if (!trimmedText) {
		return undefined
	}

	const agentMatch = trimmedText.match(AGENT_LINE_PATTERN)
	if (!agentMatch) {
		return undefined
	}
	const agent = agentMatch[1]?.trim()
	if (!agent) {
		return undefined
	}

	const promiseMatch = trimmedText.match(PROMISE_TAG_PATTERN)
	if (!promiseMatch) {
		return undefined
	}
	const promise = promiseMatch[1]?.trim()
	if (!promise) {
		return undefined
	}

	const metadataMatch = trimmedText.match(TASK_METADATA_PATTERN)
	let sessionID: string | undefined
	if (metadataMatch) {
		const metadataContent = metadataMatch[1]
		const sessionIDMatch = metadataContent.match(SESSION_ID_LINE_PATTERN)
		if (sessionIDMatch) {
			sessionID = sessionIDMatch[1]?.trim()
		}
	}

	return { agent, promise, sessionID }
}

export function isOracleVerified(text: string): boolean {
	const evidence = parseOracleVerificationEvidence(text)
	if (!evidence) {
		return false
	}

	const isOracleAgent = evidence.agent.toLowerCase() === "oracle"
	const isVerifiedPromise = evidence.promise === ULTRAWORK_VERIFICATION_PROMISE

	return isOracleAgent && isVerifiedPromise
}

export function extractOracleSessionID(text: string): string | undefined {
	const evidence = parseOracleVerificationEvidence(text)
	if (!evidence || evidence.agent.toLowerCase() !== "oracle") {
		return undefined
	}

	return evidence.sessionID
}
