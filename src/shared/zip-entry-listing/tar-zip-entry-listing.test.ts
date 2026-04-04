import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"

import * as logger from "../logger"
import { parseTarListingOutput } from "./tar-zip-entry-listing"

function createTarFileLine(fileName: string): string {
	return `-rw-r--r-- 1 user group 123 Jan 01 12:34 ${fileName}`
}

function getWarnedUnparsedLines(logSpy: ReturnType<typeof spyOn>): string[] {
	return logSpy.mock.calls.flatMap(([message, data]) => {
		if (
			message !== "warning: unparsed tar listing line" ||
			typeof data !== "object" ||
			data === null ||
			!("line" in data) ||
			typeof data.line !== "string"
		) {
			return []
		}

		return [data.line]
	})
}

function captureThrownError(run: () => void): Error {
	try {
		run()
	} catch (error) {
		if (error instanceof Error) {
			return error
		}
	}

	throw new Error("Expected parser to throw")
}

describe("parseTarListingOutput", () => {
	afterEach(() => {
		mock.restore()
	})

	describe("#given tar output with a small number of unparsed lines", () => {
		it("#when parsing the output #then logs warnings and keeps the parsed entries", () => {
			// given
			const logSpy = spyOn(logger, "log").mockImplementation(() => {})
			const listedOutput = [
				createTarFileLine("file-1.txt"),
				createTarFileLine("file-2.txt"),
				createTarFileLine("file-3.txt"),
				createTarFileLine("file-4.txt"),
				createTarFileLine("file-5.txt"),
				createTarFileLine("file-6.txt"),
				createTarFileLine("file-7.txt"),
				createTarFileLine("file-8.txt"),
				createTarFileLine("file-9.txt"),
				"unparsed listing line",
			].join("\n")

			// when
			const parsedEntries = parseTarListingOutput(listedOutput)

			// then
			expect(parsedEntries).toHaveLength(9)
			expect(logSpy).toHaveBeenCalledWith("warning: unparsed tar listing line", {
				line: "unparsed listing line",
			})
			expect(getWarnedUnparsedLines(logSpy)).toContain("unparsed listing line")
		})
	})

	describe("#given tar output with too many unparsed lines by ratio", () => {
		it("#when parsing the output #then throws a format drift error", () => {
			// given
			const logSpy = spyOn(logger, "log").mockImplementation(() => {})
			const listedOutput = [
				createTarFileLine("file-1.txt"),
				createTarFileLine("file-2.txt"),
				createTarFileLine("file-3.txt"),
				createTarFileLine("file-4.txt"),
				createTarFileLine("file-5.txt"),
				createTarFileLine("file-6.txt"),
				createTarFileLine("file-7.txt"),
				createTarFileLine("file-8.txt"),
				"unparsed listing line 1",
				"unparsed listing line 2",
			].join("\n")

			// when
			const thrownError = captureThrownError(() => parseTarListingOutput(listedOutput))

			// then
			expect(thrownError.message).toMatch(/format drift detected/i)
			expect(getWarnedUnparsedLines(logSpy)).toEqual(
				expect.arrayContaining([
					"unparsed listing line 1",
					"unparsed listing line 2",
				])
			)
		})
	})

	describe("#given tar output where every non-empty line is unparsed", () => {
		it("#when parsing the output #then rejects the listing instead of returning an empty array", () => {
			// given
			const logSpy = spyOn(logger, "log").mockImplementation(() => {})

			// when
			const thrownError = captureThrownError(() =>
				parseTarListingOutput(["unknown format 1", "unknown format 2"].join("\n"))
			)

			// then
			expect(thrownError.message).toMatch(/format drift detected/i)
			expect(getWarnedUnparsedLines(logSpy)).toEqual(
				expect.arrayContaining(["unknown format 1", "unknown format 2"])
			)
		})
	})

	describe("#given tar output with more than five unparsed lines", () => {
		it("#when parsing the output #then rejects the listing even at a ten percent ratio", () => {
			// given
			const logSpy = spyOn(logger, "log").mockImplementation(() => {})
			const parsedLines = Array.from({ length: 54 }, (_, index) =>
				createTarFileLine(`file-${index + 1}.txt`)
			)
			const listedOutput = [
				...parsedLines,
				"unparsed listing line 1",
				"unparsed listing line 2",
				"unparsed listing line 3",
				"unparsed listing line 4",
				"unparsed listing line 5",
				"unparsed listing line 6",
			].join("\n")

			// when
			const thrownError = captureThrownError(() => parseTarListingOutput(listedOutput))

			// then
			expect(thrownError.message).toMatch(/format drift detected/i)
			expect(getWarnedUnparsedLines(logSpy)).toEqual(
				expect.arrayContaining([
					"unparsed listing line 1",
					"unparsed listing line 2",
					"unparsed listing line 3",
					"unparsed listing line 4",
					"unparsed listing line 5",
					"unparsed listing line 6",
				])
			)
		})
	})
})
