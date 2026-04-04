import { spawn } from "bun"

import type { ArchiveEntry } from "../archive-entry-validator"
import { log } from "../logger"



function parseTarListedZipEntry(line: string): ArchiveEntry | null {
	const match = line.match(
		/^([^\s])\S*\s+\d+\s+\S+\s+\S+\s+\d+\s+\w+\s+\d+\s+(?:\d{2}:\d{2}|\d{4})\s+(.*)$/
	)
	if (!match) {
		return null
	}

	const [, rawType, rawEntryPath] = match
	if (rawType === "l" || rawType === "h") {
		const arrowIndex = rawEntryPath.lastIndexOf(" -> ")
		return {
			path: arrowIndex === -1 ? rawEntryPath : rawEntryPath.slice(0, arrowIndex),
			type: rawType === "l" ? "symlink" : "hardlink",
			linkPath: arrowIndex === -1 ? undefined : rawEntryPath.slice(arrowIndex + 4),
		}
	}

	return {
		path: rawEntryPath,
		type: rawType === "d" ? "directory" : "file",
	}
}

function validateParsedTarListing(
	totalLineCount: number,
	unparsedLines: string[]
): void {
	if (unparsedLines.length === 0) {
		return
	}

	throw new Error(
		`zip entry listing failed: ${unparsedLines.length}/${totalLineCount} tar listing lines could not be parsed (fail-closed)`
	)
}

export function parseTarListingOutput(stdout: string): ArchiveEntry[] {
	const listingLines = stdout
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean)

	if (listingLines.length === 0) {
		return []
	}

	const parsedEntries: ArchiveEntry[] = []
	const unparsedLines: string[] = []

	for (const listingLine of listingLines) {
		const parsedEntry = parseTarListedZipEntry(listingLine)
		if (parsedEntry === null) {
			unparsedLines.push(listingLine)
			log("warning: unparsed tar listing line", { line: listingLine })
			continue
		}

		parsedEntries.push(parsedEntry)
	}

	validateParsedTarListing(listingLines.length, unparsedLines)

	return parsedEntries
}

export async function listZipEntriesWithTar(
	archivePath: string
): Promise<ArchiveEntry[]> {
	const proc = spawn(["tar", "-tvf", archivePath], {
		stdout: "pipe",
		stderr: "pipe",
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])

	if (exitCode !== 0) {
		throw new Error(`zip entry listing failed (exit ${exitCode}): ${stderr}`)
	}

	return parseTarListingOutput(stdout)
}
