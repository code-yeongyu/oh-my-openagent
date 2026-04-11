import { spawn, spawnSync } from "bun"

import type { ArchiveEntry } from "../archive-entry-validator"

export function isPythonZipListingAvailable(): boolean {
	const proc = spawnSync(["python3", "--version"], {
		stdout: "ignore",
		stderr: "ignore",
	})

	return proc.exitCode === 0
}

export async function listZipEntriesWithPython(
	archivePath: string
): Promise<ArchiveEntry[]> {
	const script = [
		"import json, stat, sys, zipfile",
		"entries = []",
		"with zipfile.ZipFile(sys.argv[1], 'r') as archive:",
		"    for info in archive.infolist():",
		"        mode = (info.external_attr >> 16) & 0xFFFF",
		"        if stat.S_ISLNK(mode):",
		"            entry_type = 'symlink'",
		"            link_path = archive.read(info).decode('utf-8', 'surrogateescape')",
		"        elif info.filename.endswith('/'):",
		"            entry_type = 'directory'",
		"            link_path = None",
		"        else:",
		"            entry_type = 'file'",
		"            link_path = None",
		"        entry = {'path': info.filename, 'type': entry_type}",
		"        if link_path is not None:",
		"            entry['linkPath'] = link_path",
		"        entries.append(entry)",
		"print(json.dumps(entries))",
	].join("\n")

	const proc = spawn(["python3", "-c", script, archivePath], {
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

	return JSON.parse(stdout) as ArchiveEntry[]
}
