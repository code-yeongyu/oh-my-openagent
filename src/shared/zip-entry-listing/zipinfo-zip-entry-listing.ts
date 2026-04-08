import { spawn, spawnSync } from "bun"

import type { ArchiveEntry } from "../archive-entry-validator"
import { readZipSymlinkTarget } from "./read-zip-symlink-target"

export function parseZipInfoListedEntry(line: string): ArchiveEntry | null {
	const match = line.match(
		/^([-dl?])\S*\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.*)$/
	)
	if (!match) {
		return null
	}

	const [, rawType, rawEntryPath] = match
	return {
		path: rawEntryPath,
		type: rawType === "d" ? "directory" : rawType === "l" ? "symlink" : "file",
	}
}

export function isZipInfoZipListingAvailable(): boolean {
	const proc = spawnSync(["which", "zipinfo"], {
		stdout: "ignore",
		stderr: "ignore",
	})

	return proc.exitCode === 0
}

function splitZipInfoOutputLines(stdout: string): string[] {
	return stdout.split(/\r?\n/).filter(line => line.length > 0)
}

export async function listZipEntriesWithZipInfo(
	archivePath: string
): Promise<ArchiveEntry[]> {
	if (!isZipInfoZipListingAvailable()) {
		throw new Error("zip entry listing requires zipinfo, but zipinfo is not installed")
	}

	const proc = spawn(["zipinfo", "-l", archivePath], {
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

	const parsedEntries = splitZipInfoOutputLines(stdout)
		.map(line => parseZipInfoListedEntry(line))
		.filter((entry): entry is ArchiveEntry => entry !== null)

	return Promise.all(
		parsedEntries.map(async entry => {
			if (entry.type !== "symlink") {
				return entry
			}

			return {
				...entry,
				linkPath: await readZipSymlinkTarget(archivePath, entry.path),
			}
		})
	)
}
