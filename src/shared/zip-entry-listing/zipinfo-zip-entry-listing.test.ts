/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { parseZipInfoListedEntry } from "./zipinfo-zip-entry-listing"

describe("parseZipInfoListedEntry", () => {
	describe("#given a zipinfo listing line with trailing filename whitespace", () => {
		it("#when parsing the line #then preserves the original trailing whitespace", () => {
			// given
			const listedLine =
				"?rw-------  2.0 unx        1 b-        1 stor 26-Apr-03 18:33   trailing-space.txt "

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
