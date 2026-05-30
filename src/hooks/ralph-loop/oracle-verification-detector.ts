import { extractTaskLink } from "../../features/tool-metadata-store"
import { stripInvisibleAgentCharacters } from "../../shared/agent-display-names"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"

export interface OracleVerificationEvidence {
	agent: string
	promise: string
	sessionID?: string
}

const AGENT_LINE_PATTERN = /^Agent:[ \t]*(\S+)$/im
const ORACLE_VERDICT_LINE_PATTERN = /^\s*(VERIFIED|REJECTED)\b(?:\s*(?:[:.]|COMPLETE\b)|\s*$)/im
const ORACLE_ACCEPTED_VERDICT_PATTERN = /^\s*(?:completion|task|work)\s+should\s+be\s+accepted\b/im
const ORACLE_REJECTED_VERDICT_PATTERN = /^\s*(?:completion|task|work)\s+should\s+not\s+be\s+accepted\b/im
const ORACLE_VERIFIED_COMPLETE_PATTERN = /\bVERIFIED\s+COMPLETE\b/i
const ORACLE_VERIFICATION_PASSES_PATTERN = /\bverification\s+pass(?:es|ed)\b/i
const ORACLE_NOT_COMPLETE_PATTERN = /\b(?:NOT\s+VERIFIED|NOT\s+COMPLETE)\b/i

export function parseOracleVerificationEvidence(text: string): OracleVerificationEvidence | undefined {
	const trimmedText = text.trim()
	if (!trimmedText) {
		return undefined
	}

	const link = extractTaskLink(undefined, trimmedText)
	const agentMatch = trimmedText.match(AGENT_LINE_PATTERN)
	const agent = agentMatch?.[1]?.trim() ?? link.agent
	if (!agent) {
		return undefined
	}

	const promiseMatches = Array.from(trimmedText.matchAll(/<promise>[ \t]*(\S+?)[ \t]*<\/promise>/gis))
	const promiseMatch = promiseMatches.find((match) => match[1]?.trim() === ULTRAWORK_VERIFICATION_PROMISE)
	const verdictMatch = trimmedText.match(ORACLE_VERDICT_LINE_PATTERN)
	const proseVerdict = ORACLE_REJECTED_VERDICT_PATTERN.test(trimmedText) || ORACLE_NOT_COMPLETE_PATTERN.test(trimmedText)
		? "REJECTED"
		: ORACLE_ACCEPTED_VERDICT_PATTERN.test(trimmedText) || ORACLE_VERIFIED_COMPLETE_PATTERN.test(trimmedText) || ORACLE_VERIFICATION_PASSES_PATTERN.test(trimmedText)
			? ULTRAWORK_VERIFICATION_PROMISE
			: undefined
	const promise = promiseMatch?.[1]?.trim() ?? verdictMatch?.[1]?.trim() ?? proseVerdict ?? promiseMatches[0]?.[1]?.trim()
	if (!promise) {
		return undefined
	}

	const sessionID = link.sessionId

	return { agent, promise, sessionID }
}

export function parseTrustedOracleTaskVerificationEvidence(text: string): OracleVerificationEvidence | undefined {
	const link = extractTaskLink(undefined, text)
	if (!link.agent || !link.sessionId) {
		return undefined
	}
	const evidence = parseOracleVerificationEvidence(text)
	if (!evidence || evidence.promise !== ULTRAWORK_VERIFICATION_PROMISE) {
		return undefined
	}
	const isTrustedOracleAgent = stripInvisibleAgentCharacters(link.agent).toLowerCase() === "oracle"
	return isTrustedOracleAgent ? { ...evidence, agent: link.agent, sessionID: link.sessionId } : undefined
}

export function isOracleVerified(text: string): boolean {
	const evidence = parseOracleVerificationEvidence(text)
	if (!evidence) {
		return false
	}

	const isOracleAgent = stripInvisibleAgentCharacters(evidence.agent).toLowerCase() === "oracle"
	const isVerifiedPromise = evidence.promise === ULTRAWORK_VERIFICATION_PROMISE

	return isOracleAgent && isVerifiedPromise
}

export function extractOracleSessionID(text: string): string | undefined {
	const evidence = parseOracleVerificationEvidence(text)
	if (!evidence || stripInvisibleAgentCharacters(evidence.agent).toLowerCase() !== "oracle") {
		return undefined
	}

	return evidence.sessionID
}
