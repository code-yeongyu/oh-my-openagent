import { describe, expect, test } from "bun:test"
import { lintSnapshot } from "../../lint"
import { buildSnapshot } from "../../testing/build-snapshot"
import { hardOffsetShadow } from "./hard-offset-shadow"

const flagged = (shadows: Readonly<Record<string, string>>, extra: Readonly<Record<string, Readonly<Record<string, string>>>> = {}): readonly string[] => {
	const snap = buildSnapshot(
		Object.entries(shadows).map(([id, shadow]) => ({ id, style: { "box-shadow": shadow }, attributes: extra[id] ?? {} })),
	)
	return lintSnapshot(snap, { rules: [hardOffsetShadow] }).map((f) => (f.location.kind === "element" ? f.location.selector : ""))
}

describe("hard-offset-shadow", () => {
	test("#given unblurred shadows offset by 4px or more #then each is flagged", () => {
		expect(
			flagged({
				positive: "rgb(51, 51, 51) 4px 4px 0px 0px",
				negative: "rgb(51, 51, 51) -6px 6px 0px 0px",
				layered: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(51, 51, 51) 4px 4px 0px 0px, rgba(0, 0, 0, 0.12) 0px 8px 24px 0px",
			}),
		).toEqual(["#positive", "#negative", "#layered"])
	})

	test("#given soft, inset, ring, transparent, small or contracted shadows #then none is flagged", () => {
		expect(
			flagged({
				soft: "rgb(51, 51, 51) 0px 4px 12px 0px",
				inset: "rgb(51, 51, 51) 4px 4px 0px 0px inset",
				ring: "rgb(51, 51, 51) 0px 0px 0px 4px",
				transparent: "rgba(0, 0, 0, 0) 4px 4px 0px 0px",
				small: "rgb(51, 51, 51) 2px 2px 0px 0px",
				contracted: "rgb(51, 51, 51) 4px 4px 0px -8px",
			}),
		).toEqual([])
	})

	test("#given a hard shadow waived with data-detect-ignore #then it is not flagged", () => {
		expect(flagged({ waived: "rgb(51, 51, 51) 4px 4px 0px 0px" }, { waived: { "data-detect-ignore": "hard-offset-shadow" } })).toEqual([])
	})

	test("#given the rule is switched off in config #then nothing is reported", () => {
		const snap = buildSnapshot([{ id: "x", style: { "box-shadow": "rgb(51, 51, 51) 4px 4px 0px 0px" } }])
		expect(lintSnapshot(snap, { rules: [hardOffsetShadow], config: { rules: { "hard-offset-shadow": "off" } } })).toEqual([])
	})
})
