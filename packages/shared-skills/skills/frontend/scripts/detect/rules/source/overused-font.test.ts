import { expect, test } from "bun:test"
import { overusedFont } from "./overused-font"
import { checkSource } from "./support/check-source"

test.each([
	["font-family: 'Inter', sans-serif;", 1],
	["font-family: 'Instrument Serif';", 1],
	['@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400");', 1],
	["font-family: Georgia, serif;", 0],
	["/* font-family: Inter; */", 0],
	['@import url("https://fonts.googleapis.com/css?family=DM+Sans:400|Inter:400");', 1],
	["const A = styled.div`/* font-family: Inter */ font-family: Georgia;`", 0],
])("#given font source %s #then returns %i findings", (source, count) => {
	expect(checkSource(overusedFont, source)).toHaveLength(count)
})

test("#given a case-insensitive allowed font #then suppresses only that family", () => {
	expect(checkSource(overusedFont, ".a{font-family: Inter}\n.b{font-family: Roboto}", { path: "a.css", config: { allowFonts: ["INTER"] } })).toHaveLength(1)
	const source = '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Roboto:wght@400");'
	expect(checkSource(overusedFont, source, { config: { allowFonts: ["INTER"] } })[0]?.message).toBe("Google Fonts: roboto")
})
