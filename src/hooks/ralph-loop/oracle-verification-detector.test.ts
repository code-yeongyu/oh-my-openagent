/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
	extractOracleSessionID,
	isOracleVerified,
	parseOracleVerificationEvidence,
} from "./oracle-verification-detector"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"

describe("parseOracleVerificationEvidence", () => {
	test("#given valid oracle verification text #then should parse all fields", () => {
		// #given
		const text = `Task completed.

Agent: oracle

<promise>VERIFIED</promise>

<task_metadata>
session_id: ses_oracle_123
</task_metadata>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeDefined()
		expect(evidence?.agent).toBe("oracle")
		expect(evidence?.promise).toBe("VERIFIED")
		expect(evidence?.sessionID).toBe("ses_oracle_123")
	})

	test("#given text without agent line #then should return undefined", () => {
		// #given
		const text = `<promise>VERIFIED</promise>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeUndefined()
	})

	test("#given text without promise tag #then should return undefined", () => {
		// #given
		const text = `Agent: oracle`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeUndefined()
	})

	test("#given text with empty agent #then should return undefined", () => {
		// #given
		const text = `Agent:   

<promise>VERIFIED</promise>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeUndefined()
	})

	test("#given text with empty promise #then should return undefined", () => {
		// #given
		const text = `Agent: oracle

<promise>   </promise>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeUndefined()
	})

	test("#given text without metadata #then should parse agent and promise only", () => {
		// #given
		const text = `Agent: oracle

<promise>VERIFIED</promise>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeDefined()
		expect(evidence?.agent).toBe("oracle")
		expect(evidence?.promise).toBe("VERIFIED")
		expect(evidence?.sessionID).toBeUndefined()
	})

	test("#given text with metadata but no session_id #then should parse agent and promise only", () => {
		// #given
		const text = `Agent: oracle

<promise>VERIFIED</promise>

<task_metadata>
other_field: value
</task_metadata>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeDefined()
		expect(evidence?.agent).toBe("oracle")
		expect(evidence?.promise).toBe("VERIFIED")
		expect(evidence?.sessionID).toBeUndefined()
	})

	test("#given empty text #then should return undefined", () => {
		// #given
		const text = ""

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeUndefined()
	})

	test("#given whitespace-only text #then should return undefined", () => {
		// #given
		const text = "   \n\t  "

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeUndefined()
	})

	test("#given agent with different casing #then should preserve original case", () => {
		// #given
		const text = `Agent: ORACLE

<promise>VERIFIED</promise>`

		// #when
		const evidence = parseOracleVerificationEvidence(text)

		// #then
		expect(evidence).toBeDefined()
		expect(evidence?.agent).toBe("ORACLE")
	})
})

describe("isOracleVerified", () => {
	test("#given valid oracle verification #then should return true", () => {
		// #given
		const text = `Agent: oracle

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>`

		// #when
		const result = isOracleVerified(text)

		// #then
		expect(result).toBe(true)
	})

	test("#given non-oracle agent #then should return false", () => {
		// #given
		const text = `Agent: sisyphus

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>`

		// #when
		const result = isOracleVerified(text)

		// #then
		expect(result).toBe(false)
	})

	test("#given wrong promise #then should return false", () => {
		// #given
		const text = `Agent: oracle

<promise>DONE</promise>`

		// #when
		const result = isOracleVerified(text)

		// #then
		expect(result).toBe(false)
	})

	test("#given oracle agent with different casing #then should return true", () => {
		// #given
		const text = `Agent: ORACLE

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>`

		// #when
		const result = isOracleVerified(text)

		// #then
		expect(result).toBe(true)
	})

	test("#given empty text #then should return false", () => {
		// #given
		const text = ""

		// #when
		const result = isOracleVerified(text)

		// #then
		expect(result).toBe(false)
	})
})

describe("extractOracleSessionID", () => {
	test("#given valid oracle verification with session_id #then should return session_id", () => {
		// #given
		const text = `Agent: oracle

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>

<task_metadata>
session_id: ses_oracle_123
</task_metadata>`

		// #when
		const sessionID = extractOracleSessionID(text)

		// #then
		expect(sessionID).toBe("ses_oracle_123")
	})

	test("#given valid oracle verification without session_id #then should return undefined", () => {
		// #given
		const text = `Agent: oracle

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>`

		// #when
		const sessionID = extractOracleSessionID(text)

		// #then
		expect(sessionID).toBeUndefined()
	})

	test("#given non-oracle agent #then should return undefined", () => {
		// #given
		const text = `Agent: sisyphus

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>

<task_metadata>
session_id: ses_sis_123
</task_metadata>`

		// #when
		const sessionID = extractOracleSessionID(text)

		// #then
		expect(sessionID).toBeUndefined()
	})

	test("#given non-oracle agent with different casing #then should return undefined", () => {
		// #given
		const text = `Agent: SISYPHUS

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>

<task_metadata>
session_id: ses_sis_123
</task_metadata>`

		// #when
		const sessionID = extractOracleSessionID(text)

		// #then
		expect(sessionID).toBeUndefined()
	})

	test("#given empty text #then should return undefined", () => {
		// #given
		const text = ""

		// #when
		const sessionID = extractOracleSessionID(text)

		// #then
		expect(sessionID).toBeUndefined()
	})
})
