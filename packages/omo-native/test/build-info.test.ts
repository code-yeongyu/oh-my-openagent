import { describe, expect, test } from "bun:test"
import { buildLabel, parseBuildInfo, shortSha, versionLines, type OmoBuildInfo } from "../build-info"

const fixture: OmoBuildInfo = {
	command: "omob",
	omo: { commit: "c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", committedAt: "2026-09-04T10:17:49+09:00", branch: "dev" },
	engine: { commit: "7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7", committedAt: "2026-09-04T10:49:12+09:00", branch: "main" },
}

describe("omob build info", () => {
	test("round-trips a stamped build info object", () => {
		expect(parseBuildInfo(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture)
	})

	test("rejects malformed payloads", () => {
		expect(parseBuildInfo(undefined)).toBeUndefined()
		expect(parseBuildInfo({})).toBeUndefined()
		expect(parseBuildInfo(null)).toBeUndefined()
		expect(parseBuildInfo({ ...fixture, omo: { commit: "not-a-sha", committedAt: "x", branch: "y" } })).toBeUndefined()
		expect(parseBuildInfo({ ...fixture, omo: { commit: "c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", committedAt: 42, branch: "dev" } })).toBeUndefined()
	})

	test("labels carry short shas and human commit dates", () => {
		expect(buildLabel(fixture)).toBe("omo@c6e7dd7 2026-09-04 10:17 +09:00 · senpi@7fd18df 2026-09-04 10:49 +09:00")
	})

	test("version lines carry full shas, ISO commit dates, and branches", () => {
		expect(versionLines(fixture)).toEqual([
			"omob dev build",
			"omo   c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc 2026-09-04T10:17:49+09:00 (dev)",
			"senpi 7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7 2026-09-04T10:49:12+09:00 (main)",
		])
	})

	test("shortSha truncates to seven characters", () => {
		expect(shortSha("abcdef1234")).toBe("abcdef1")
	})
})
