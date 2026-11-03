import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { wideTracking } from "./wide-tracking"

test("#given tracked prose, capitals, CJK and control labels #then reading text alone reports", () => {
	const style = { "font-size": "16px", "letter-spacing": "2px" }
	const snapshot = buildSnapshot([
		{ id: "prose", text: "Letter spacing this wide breaks natural word shapes.", style },
		{ id: "mixed", tag: "span", text: "Fall 2026 technology preview", style },
		{ id: "caps-sentence", text: "SUPPORT HOURS RUN MONDAY TO FRIDAY, FROM NINE IN THE MORNING UNTIL SIX IN THE EVENING, EXCEPT ON PUBLIC HOLIDAYS.", style },
		{ text: "NOW AVAILABLE ACROSS THE UNITED STATES, CANADA AND NEW ZEALAND", style },
		{ text: "Short capitals label made from mixed source text", style: { ...style, "text-transform": "uppercase" } },
		{ text: "台風が近づいているときに気をつけることは何ですか？", style },
		{ tag: "button", text: "A compact action label", style },
		{ text: "Reading copy at the exact tracking floor.", style: { ...style, "letter-spacing": "0.8px" } },
	])
	expect(wideTracking.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#prose", "#mixed", "#caps-sentence"])
})

test("#given typed capitals forced lowercase beside normal capitals #then the lowercase run reports", () => {
	const snapshot = buildSnapshot([
		{ id: "lower", text: "LIMITED EDITION RELEASE 2026", style: { "letter-spacing": "2px", "text-transform": "lowercase" } },
		{ text: "LIMITED EDITION RELEASE 2026", style: { "letter-spacing": "2px" } },
	])
	expect(wideTracking.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#lower"])
})
