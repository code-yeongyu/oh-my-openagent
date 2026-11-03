import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { theaterSlopPhrase } from "./theater-slop-phrase"

test("#given dismissive framing and literal theaters #then only the closed vocabulary reports", () => {
	const check = (text: string) => theaterSlopPhrase.check({ snapshot: buildSnapshot([{ text }]), config: {} })
	for (const text of ["Security theater", "growth THEATER", "Accessibility theater"]) expect(check(text)).toHaveLength(1)
	for (const text of ["Southern Theater Command", "The official theater", "A theater of operations", "security theatrical"]) expect(check(text)).toHaveLength(0)
})

test("#given framing split across inline elements #then rendered words still match", () => {
	const check = (text: string) => theaterSlopPhrase.check({
		snapshot: buildSnapshot([{ tag: "p", children: [{ tag: "span", text }, { tag: "em", text: "theater" }] }]), config: {},
	})
	expect(check("privacy")).toHaveLength(1)
	expect(check("national")).toHaveLength(0)
})
