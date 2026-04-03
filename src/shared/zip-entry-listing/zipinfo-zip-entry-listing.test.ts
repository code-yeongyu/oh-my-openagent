import { describe, expect, it } from "bun:test"

import { parseZipInfoListedEntry } from "./zipinfo-zip-entry-listing"

describe("parseZipInfoListedEntry", () => {
	describe("#given a zipinfo listing line with trailing filename whitespace", () => {
		it("#when parsing the line #then preserves the original trailing whitespace", () => {
			// given
			const listedLine =
				"-rw-a--     2.0 fat        4 b- defN 03-Apr-26 12:34   trailing-space.txt "

			// when
			const parsedEntry = parseZipInfoListedEntry(listedLine)

			// then
			expect(parsedEntry).toEqual({
				path: "trailing-space.txt ",
				type: "file",
			})
		})
	})
})
