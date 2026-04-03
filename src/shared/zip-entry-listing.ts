import { spawn, spawnSync } from "bun"

import type { ArchiveEntry } from "./archive-entry-validator"

function parseTarListedZipEntry(line: string): ArchiveEntry | null {
	const match = line.match(/^([^\s])\S*\s+\d+\s+\S+\s+\S+\s+\d+\s+\w+\s+\d+\s+(?:\d{2}:\d{2}|\d{4})\s+(.*)$/)
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

export async function listZipEntriesWithTar(archivePath: string): Promise<ArchiveEntry[]> {
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

export function isPythonZipListingAvailable(): boolean {
	const proc = spawnSync(["python3", "--version"], {
		stdout: "ignore",
		stderr: "ignore",
	})

	return proc.exitCode === 0
}

export async function listZipEntriesWithPython(archivePath: string): Promise<ArchiveEntry[]> {
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

export async function listZipEntriesWithPowerShell(
	archivePath: string,
	escapePowerShellPath: (path: string) => string,
	extractor: "pwsh" | "powershell"
): Promise<ArchiveEntry[]> {
	const proc = spawn(
		[
			extractor,
			"-Command",
			[
				"Add-Type -AssemblyName System.IO.Compression.FileSystem",
				`$archive = [System.IO.Compression.ZipFile]::OpenRead('${escapePowerShellPath(archivePath)}')`,
				"try {",
				"  foreach ($entry in $archive.Entries) {",
				"    $mode = ($entry.ExternalAttributes -shr 16) -band 0xFFFF",
				"    $type = if (($mode -band 0xF000) -eq 0xA000) { 'symlink' } elseif ($entry.FullName.EndsWith('/')) { 'directory' } else { 'file' }",
				"    $target = ''",
				"    if ($type -eq 'symlink') {",
				"      $stream = $entry.Open()",
				"      try {",
				"        $reader = New-Object System.IO.StreamReader($stream)",
				"        try { $target = $reader.ReadToEnd() } finally { $reader.Dispose() }",
				"      } finally { $stream.Dispose() }",
				"    }",
				"    Write-Output ($type + \"`t\" + $entry.FullName + \"`t\" + $target)",
				"  }",
				"} finally {",
				"  $archive.Dispose()",
				"}",
			].join("; "),
		],
		{
			stdout: "pipe",
			stderr: "pipe",
		}
	)

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
		.map((line): ArchiveEntry | null => {
			const [type, entryPath, linkPath = ""] = line.split("\t")
			if (type !== "file" && type !== "directory" && type !== "symlink") {
				return null
			}

			if (type === "symlink") {
				return {
					path: entryPath,
					type,
					linkPath,
				}
			}

			return {
				path: entryPath,
				type,
			}
		})
		.filter((entry): entry is ArchiveEntry => entry !== null)
}
