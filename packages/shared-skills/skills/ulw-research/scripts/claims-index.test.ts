import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { indexClaims } from "./claims-index.mjs"

const FIXTURE = join(import.meta.dir, "tests", "fixtures", "fidelity", "claim-graph.md")

describe("indexClaims", () => {
	test("indexes the fixture claim graph", () => {
		const { claims, errors } = indexClaims(readFileSync(FIXTURE, "utf8"))
		expect(errors).toEqual([])
		expect(claims.map((claim: { claim_id: string; in_verified: boolean }) => claim.claim_id)).toEqual(["C1", "C2", "C3"])
		expect(claims.filter((claim: { claim_id: string; in_verified: boolean }) => claim.in_verified).map((claim: { claim_id: string; in_verified: boolean }) => claim.claim_id)).toEqual(["C1"])
		expect(claims[0]).toEqual({
			claim_id: "C1",
			statement: "The bridge span is up to 320 m.",
			risk: "high",
			status: "supported",
			in_verified: true,
		})
		expect(claims[2].status).toBe("refuted")
	})

	test("a malformed table returns errors", () => {
		const bad = [
			"| claim_id | statement | risk tier | status |",
			"|---|---|---|---|",
			"| X1 | bad id | high | supported |",
			"| C2 | too few cells |",
		].join("\n")
		const { errors } = indexClaims(bad)
		expect(errors.length).toBeGreaterThanOrEqual(2)
	})

	test("fenced code blocks are skipped: a fenced heading does not end the digest and a fenced entry does not verify", () => {
		const text = [
			"| claim_id | statement | risk tier | status |",
			"|---|---|---|---|",
			"| C1 | one | high | supported |",
			"| C2 | two | low | supported |",
			"",
			"## verified-claims",
			"```",
			"# not a heading",
			"- C2",
			"```",
			"- C1",
		].join("\n")
		const { claims, errors } = indexClaims(text)
		expect(errors).toEqual([])
		expect(claims.map((claim: { in_verified: boolean }) => claim.in_verified)).toEqual([true, false])
	})

	test("a document without the claim table returns an error", () => {
		const { claims, errors } = indexClaims("# claim graph\n\nno table here\n")
		expect(claims).toEqual([])
		expect(errors.length).toBe(1)
	})

	test("a verified id with no claim row is an error", () => {
		const text = "## verified-claims\n\n- C9\n\n| claim_id | statement | risk tier | status |\n|---|---|---|---|\n| C1 | a | high | supported |\n"
		expect(indexClaims(text).errors.some((e: string) => e.includes("C9"))).toBe(true)
	})

	test("only the leading claim id of a verified entry is verified", () => {
		const text = [
			"## verified-claims",
			"",
			"- C1 (merged from C2)",
			"",
			"| claim_id | statement | risk tier | status |",
			"|---|---|---|---|",
			"| C1 | a, see C2 | high | supported |",
			"| C2 | b | high | unresolved |",
		].join("\n")
		const { claims, errors } = indexClaims(text)
		expect(errors).toEqual([])
		expect(claims.map((claim: { claim_id: string; in_verified: boolean }) => [claim.claim_id, claim.in_verified])).toEqual([
			["C1", true],
			["C2", false],
		])
	})

	test("a verified-claims line verifies only as a list item or a table row, never as prose", () => {
		const text = [
			"## verified-claims",
			"",
			"- C1",
			"C2 is pending review",
			"1) C3",
			"| C4 | merged |",
			"",
			"| claim_id | statement | risk tier | status |",
			"|---|---|---|---|",
			"| C1 | a | high | supported |",
			"| C2 | b | high | unresolved |",
			"| C3 | c | high | supported |",
			"| C4 | d | high | supported |",
		].join("\n")
		const { claims, errors } = indexClaims(text)
		expect(errors).toEqual([])
		expect(claims.map((claim: { claim_id: string; in_verified: boolean }) => [claim.claim_id, claim.in_verified])).toEqual([
			["C1", true],
			["C2", false],
			["C3", true],
			["C4", true],
		])
	})

	test("the SKILL.md synthesis heading 'Verified claims' is recognized", () => {
		const text = "## Verified claims\n\n- C1\n\n| claim_id | statement | risk tier | status |\n|---|---|---|---|\n| C1 | a | high | supported |\n"
		expect(indexClaims(text).claims[0].in_verified).toBe(true)
	})

	test("a digest heading with a suffix is an error naming the heading, not a silently empty digest", () => {
		const text = "## Verified claims (2)\n\n- C1\n\n| claim_id | statement | risk tier | status |\n|---|---|---|---|\n| C1 | a | high | supported |\n"
		const { claims, errors } = indexClaims(text)
		expect(claims[0].in_verified).toBe(false)
		expect(errors.some((e: string) => e.startsWith("line 1:") && e.includes('"## Verified claims (2)"'))).toBe(true)
	})

	test("the verified-claims section ends at the claim table", () => {
		const text = [
			"## verified-claims",
			"- C1",
			"",
			"| claim_id | statement | risk tier | status |",
			"|---|---|---|---|",
			"| C1 | a | high | supported |",
			"| C2 | b | high | unresolved |",
			"",
			"C2 still pending",
		].join("\n")
		const { claims, errors } = indexClaims(text)
		expect(errors).toEqual([])
		expect(claims.map((claim: { claim_id: string; in_verified: boolean }) => [claim.claim_id, claim.in_verified])).toEqual([
			["C1", true],
			["C2", false],
		])
	})

	test("a GFM two-dash separator row is accepted and the first data row is read", () => {
		const text = "| claim_id | statement | risk tier | status |\n|--|--|--|--|\n| C1 | a | high | supported |\n| C2 | b | normal | unresolved |\n"
		const { claims, errors } = indexClaims(text)
		expect(errors).toEqual([])
		expect(claims.map((claim: { claim_id: string }) => claim.claim_id)).toEqual(["C1", "C2"])
	})
})
