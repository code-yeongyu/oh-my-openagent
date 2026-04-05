import { describe, expect, it } from "bun:test"

import { validateArchiveEntries } from "../archive-entry-validator"
import { parsePowerShellZipEntryLine } from "./powershell-zip-entry-listing"

describe("parsePowerShellZipEntryLine", () => {
	describe("#given a json entry line with tab characters in the file name", () => {
		it("#when parsing and validating the entry #then preserves the full path for traversal checks", () => {
			// given
			const entryLine = JSON.stringify({
				type: "file",
				name: `safe.txt\t../../escape.txt`,
				target: "",
			})

			// when
			const parsedEntry = parsePowerShellZipEntryLine(entryLine)
			const validateParsedEntry = () =>
				validateArchiveEntries(parsedEntry ? [parsedEntry] : [], "/tmp/archive-root")

			// then
			expect(parsedEntry).toEqual({
				path: `safe.txt\t../../escape.txt`,
				type: "file",
			})
			expect(validateParsedEntry).toThrow(/path traversal/i)
		})
	})
})
