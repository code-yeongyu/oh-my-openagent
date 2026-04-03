import { spawn } from "bun"

import type { ArchiveEntry } from "../archive-entry-validator"

function parseTarListedZipEntry(line: string): ArchiveEntry | null {
	const match = line.match(
		/^([^\s])\S*\s+\d+\s+\S+\s+\S+\s+\d+\s+\w+\s+\d+\s+(?:\d{2}:\d{2}|\d{4})\s+(.*)$/
	)
	if (!match) {
		return null
	}

	const [, rawType, rawEntryPath] = match
	if (rawType === "l") {
		const arrowIndex = rawEntryPath.lastIndexOf(" -> ")
		return {
			path: arrowIndex === -1 ? rawEntryPath : rawEntryPath.slice(0, arrowIndex),
			type: "symlink",
			linkPath: arrowIndex === -1 ? undefined : rawEntryPath.slice(arrowIndex + 4),
		}
	}

	return {
		path: rawEntryPath,
		type: rawType === "d" ? "directory" : "file",
	}
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

	return stdout
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean)
		.map(line => parseTarListedZipEntry(line))
		.filter((entry): entry is ArchiveEntry => entry !== null)
}
