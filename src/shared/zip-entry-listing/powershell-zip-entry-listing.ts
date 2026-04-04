import { spawn } from "bun"

import type { ArchiveEntry } from "../archive-entry-validator"

export type PowerShellZipExtractor = "pwsh" | "powershell"

type PowerShellZipEntryRecord = {
	type: "file" | "directory" | "symlink"
	name: string
	target: string
}

function isPowerShellZipEntryRecord(value: unknown): value is PowerShellZipEntryRecord {
	if (!value || typeof value !== "object") {
		return false
	}

	const candidate = value as Record<string, unknown>
	return (
		(candidate.type === "file" || candidate.type === "directory" || candidate.type === "symlink") &&
		typeof candidate.name === "string" &&
		typeof candidate.target === "string"
	)
}

export function parsePowerShellZipEntryLine(line: string): ArchiveEntry | null {
	const parsedValue: unknown = JSON.parse(line)
	if (!isPowerShellZipEntryRecord(parsedValue)) {
		return null
	}

	if (parsedValue.type === "symlink") {
		return {
			path: parsedValue.name,
			type: parsedValue.type,
			linkPath: parsedValue.target,
		}
	}

	return {
		path: parsedValue.name,
		type: parsedValue.type,
	}
}

export async function listZipEntriesWithPowerShell(
	archivePath: string,
	escapePowerShellPath: (path: string) => string,
	extractor: PowerShellZipExtractor
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
					"    Write-Output (ConvertTo-Json @{type=$type; name=$entry.FullName; target=$target} -Compress)",
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
		.map(line => parsePowerShellZipEntryLine(line))
		.filter((entry): entry is ArchiveEntry => entry !== null)
}
