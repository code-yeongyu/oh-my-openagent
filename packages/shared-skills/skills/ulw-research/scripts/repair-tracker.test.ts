import { describe, expect, test } from "bun:test"

import { REPAIR_DEFAULTS, validateRepairState } from "./contracts.mjs"
import {
	RepairTrackerError,
	createTracker,
	decide,
	deserializeState,
	isArtifactOk,
	serializeState,
} from "./repair-tracker.mjs"

const START = "2026-09-24T00:00:00.000Z"
const MINUTE = 60 * 1000
const OK = { artifactOk: true }

function at(minutes: number): string {
	return new Date(Date.parse(START) + minutes * MINUTE).toISOString()
}

function defects(...codes: string[]) {
	return codes.map((code) => ({ code, message: `${code} found` }))
}

type Step = { codes: string[]; minutes?: number }

function runSequence(options: Record<string, unknown>, steps: Step[], extra: Record<string, unknown> = OK) {
	let state = createTracker({ startedAt: START, ...options })
	const decisions = []
	for (const [index, step] of steps.entries()) {
		const result = decide(state, defects(...step.codes), at(step.minutes ?? index), extra)
		state = result.state
		decisions.push(result.decision)
	}
	return { state, decisions }
}

describe("createTracker", () => {
	test("#given no budget #when a tracker is created #then it uses REPAIR_DEFAULTS and validates", () => {
		const state = createTracker({ startedAt: START })

		expect(state.budget).toEqual({ ...REPAIR_DEFAULTS })
		expect(state.attempts).toEqual([])
		expect(state.consecutiveNonProgress).toBe(0)
		expect(validateRepairState(state)).toEqual({ ok: true, errors: [] })
	})

	test("#given no startedAt #when a tracker is created #then it throws instead of reading the clock", () => {
		// @ts-expect-error startedAt is deliberately omitted to prove the runtime guard
		expect(() => createTracker({})).toThrow(RepairTrackerError)
	})

	test("#given an empty integrityCodes list #when a blocker remains at stop #then the integrity code is still blocking", () => {
		const { decisions } = runSequence({ maxAttempts: 1, integrityCodes: [] }, [
			{ codes: ["missing_citation_section"] },
			{ codes: ["missing_citation_section", "heading_generic"] },
		])

		expect(decisions[1]).toMatchObject({ action: "block", reason: "blocking" })
	})

	test("#given an extra integrity code #when it remains at stop #then delivery is blocked on it", () => {
		const { decisions } = runSequence({ maxAttempts: 1, integrityCodes: ["em_dash_in_prose"] }, [
			{ codes: ["em_dash_in_prose"] },
			{ codes: ["em_dash_in_prose", "heading_generic"] },
		])

		expect(decisions[1].action).toBe("block")
		expect(decisions[1].blocking.map((d: { code: string }) => d.code)).toEqual(["em_dash_in_prose"])
	})

	test("#given an unknown integrity code #when a tracker is created #then it throws a typed error", () => {
		expect(() => createTracker({ startedAt: START, integrityCodes: ["not_a_code"] })).toThrow(RepairTrackerError)
	})
})

describe("decide stop conditions", () => {
	test("#given plateauLimit 2 #when the measure stops improving twice #then the fourth decide stops with plateau", () => {
		// [0,3,1] -> [0,2,1] -> [0,2,1] -> [0,2,1], every signature distinct
		const { decisions, state } = runSequence({ maxAttempts: 5, plateauLimit: 2 }, [
			{ codes: ["emoji_in_prose", "em_dash_in_prose", "unsourced_number", "heading_generic"] },
			{ codes: ["chart_without_figure", "chart_svg_no_text", "heading_too_long"] },
			{ codes: ["korean_no_keep_all", "korean_serif_font", "palette_off_token"] },
			{ codes: ["layout_overflow", "layout_text_clipped", "en_dash_in_prose"] },
		])

		expect(decisions.slice(0, 3).map((d) => d.action)).toEqual(["repair", "repair", "repair"])
		expect(decisions[3]).toMatchObject({ action: "deliver", reason: "plateau" })
		expect(decisions[3].residual.map((d: { code: string }) => d.code)).toEqual([
			"layout_overflow",
			"layout_text_clipped",
			"en_dash_in_prose",
		])
		expect(state.consecutiveNonProgress).toBe(2)
	})

	test("#given the literal blocker plateau sequence #when it stops #then the integrity codes block delivery", () => {
		// [2,1,0] -> [1,1,0] -> [1,1,0] -> [1,1,0]
		const { decisions } = runSequence({ maxAttempts: 5, plateauLimit: 2 }, [
			{ codes: ["missing_citation_section", "missing_closing_section", "emoji_in_prose"] },
			{ codes: ["missing_citation_section", "em_dash_in_prose"] },
			{ codes: ["missing_closing_section", "unsourced_number"] },
			{ codes: ["broken_asset_reference", "layout_overflow"] },
		])

		expect(decisions.slice(0, 3).map((d) => d.action)).toEqual(["repair", "repair", "repair"])
		expect(decisions[3]).toMatchObject({ action: "block", reason: "blocking" })
		expect(decisions[3].blocking.map((d: { code: string }) => d.code)).toEqual(["broken_asset_reference"])
	})

	test("#given signatures A, B, A #when the third decide runs #then it stops with oscillation", () => {
		const { decisions } = runSequence({ maxAttempts: 5 }, [
			{ codes: ["emoji_in_prose", "heading_generic"] },
			{ codes: ["unsourced_number"] },
			{ codes: ["heading_generic", "emoji_in_prose"] },
		])

		expect(decisions.map((d) => d.action)).toEqual(["repair", "repair", "deliver"])
		expect(decisions[2].reason).toBe("oscillation")
	})

	test("#given oscillation and plateau both hold #when decided #then oscillation wins by precedence", () => {
		const { decisions } = runSequence({ maxAttempts: 5, plateauLimit: 1 }, [
			{ codes: ["unsourced_number"] },
			{ codes: ["unsourced_number"] },
		])

		expect(decisions[1]).toMatchObject({ action: "deliver", reason: "oscillation" })
	})

	test("#given maxAttempts 3 and improving measures #when the fourth decide runs #then it stops with max_attempts", () => {
		// [0,3,0] -> [0,2,0] -> [0,1,0] -> [0,1,0], every signature distinct
		const { decisions } = runSequence({ maxAttempts: 3 }, [
			{ codes: ["emoji_in_prose", "em_dash_in_prose", "unsourced_number"] },
			{ codes: ["chart_without_figure", "chart_svg_no_text"] },
			{ codes: ["korean_serif_font"] },
			{ codes: ["layout_text_clipped"] },
		])

		expect(decisions.slice(0, 3).map((d) => d.action)).toEqual(["repair", "repair", "repair"])
		expect(decisions[3]).toMatchObject({ action: "deliver", reason: "max_attempts" })
	})

	test("#given the literal blocker max_attempts sequence #when the fourth decide runs #then it blocks", () => {
		// [3,0,0] -> [2,0,0] -> [1,0,0] -> [1,0,0]
		const { decisions } = runSequence({ maxAttempts: 3 }, [
			{ codes: ["missing_citation_section", "missing_closing_section", "broken_asset_reference"] },
			{ codes: ["missing_citation_section", "missing_required_section"] },
			{ codes: ["missing_closing_section"] },
			{ codes: ["missing_citation_section"] },
		])

		expect(decisions.slice(0, 3).map((d) => d.action)).toEqual(["repair", "repair", "repair"])
		expect(decisions[3]).toMatchObject({ action: "block", reason: "blocking" })
	})

	test("#given wallClockMs 900000 and improving measures #when now is start + 15 min #then it stops with wall_clock", () => {
		const { decisions } = runSequence({ maxAttempts: 5, wallClockMs: 900000 }, [
			{ codes: ["emoji_in_prose", "em_dash_in_prose"], minutes: 0 },
			{ codes: ["unsourced_number"], minutes: 7 },
			{ codes: ["heading_generic"], minutes: 15 },
		])

		expect(decisions.map((d) => d.action)).toEqual(["repair", "repair", "deliver"])
		expect(decisions[2].reason).toBe("wall_clock")
	})

	test("#given an integrity code and no stop condition #when decided #then it schedules a repair", () => {
		const { decisions } = runSequence({}, [{ codes: ["missing_citation_section"] }])

		expect(decisions[0]).toMatchObject({ action: "repair", reason: null })
		expect(decisions[0].blocking.map((d: { code: string }) => d.code)).toEqual(["missing_citation_section"])
	})

	test("#given a stop without a usable artifact #when decided #then it blocks with the stop reason", () => {
		const { decisions } = runSequence({ maxAttempts: 1 }, [{ codes: ["emoji_in_prose"] }, { codes: ["heading_generic"] }], {
			artifactOk: false,
		})

		expect(decisions[1]).toMatchObject({ action: "block", reason: "max_attempts", blocking: [] })
	})

	test("#given zero defects #when decided #then it delivers clean", () => {
		const { decisions } = runSequence({ maxAttempts: 1 }, [{ codes: ["emoji_in_prose"] }, { codes: [] }], { artifactOk: false })

		expect(decisions[1]).toEqual({ action: "deliver", reason: "clean", residual: [], blocking: [] })
	})

	test("#given a defect with an unknown code #when decided #then it throws a typed error", () => {
		const state = createTracker({ startedAt: START })
		let caught: unknown
		try {
			decide(state, [{ code: "made_up_code", message: "x" }], at(1), OK)
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(RepairTrackerError)
		expect((caught as RepairTrackerError).code).toBe("unknown_defect_code")
	})

	test("#given an invalid now #when decided #then it throws a typed error", () => {
		const state = createTracker({ startedAt: START })

		expect(() => decide(state, [], "not a date", OK)).toThrow(RepairTrackerError)
	})

	test("#given a state #when decided #then the input state is not mutated", () => {
		const state = createTracker({ startedAt: START })
		const before = serializeState(state)
		decide(state, defects("emoji_in_prose"), at(1), OK)

		expect(serializeState(state)).toBe(before)
	})
})

describe("isArtifactOk", () => {
	test("#given bytes and renders #when checked #then it needs at least 512 bytes and one render", () => {
		expect(isArtifactOk({ bytes: 512, renders: 1 })).toBe(true)
		expect(isArtifactOk({ bytes: 511, renders: 1 })).toBe(false)
		expect(isArtifactOk({ bytes: 4096, renders: 0 })).toBe(false)
	})
})

describe("serializeState / deserializeState", () => {
	test("#given a state after several decides #when round-tripped #then the bytes are identical and valid", () => {
		const { state } = runSequence({ maxAttempts: 5 }, [{ codes: ["emoji_in_prose"] }, { codes: ["heading_generic"] }])
		const text = serializeState(state)
		const restored = deserializeState(text)

		expect(serializeState(restored)).toBe(text)
		expect(validateRepairState(restored)).toEqual({ ok: true, errors: [] })
	})

	test("#given a restored state #when decide continues #then it keeps the attempt history", () => {
		const { state } = runSequence({ maxAttempts: 5 }, [{ codes: ["emoji_in_prose"] }, { codes: ["heading_generic"] }])
		const { decision } = decide(deserializeState(serializeState(state)), defects("emoji_in_prose"), at(3), OK)

		expect(decision.reason).toBe("oscillation")
	})

	test("#given an invalid state file #when deserialized #then it throws a typed error", () => {
		expect(() => deserializeState('{"schemaVersion":1}')).toThrow(RepairTrackerError)
		expect(() => deserializeState("not json")).toThrow(RepairTrackerError)
	})
})
