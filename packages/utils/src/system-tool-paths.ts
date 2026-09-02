import { existsSync } from "node:fs"

/**
 * Resolve a Windows System32 tool by absolute path
 * Defaults to `%SystemRoot%\System32\<toolRelativePath>` or `C:\Windows\System32\<toolRelativePath>`
 */
export function resolveWindowsSystemTool(
	toolRelativePath: string,
	systemRoot: string | undefined = process.env["SystemRoot"],
): string {
	const root = systemRoot === undefined || systemRoot === "" ? "C:\\Windows" : systemRoot
	return `${root}\\System32\\${toolRelativePath}`
}

/**
 * Fail-closed variant: validates the resolved path exists before handing it to
 * a spawn call. A missing/empty SystemRoot falls back to C:\Windows (matching
 * resolveWindowsSystemTool); a root that points nowhere yields a nonfatal miss
 * carrying the attempted path so callers can degrade instead of throwing
 * ENOENT from an unhandled spawn error event (issue #6738).
 *
 * Accepts an optional existsSync injectable for portable unit tests (e.g. Linux CI).
 */
export function resolveWindowsSystemToolExistent(
	toolRelativePath: string,
	systemRoot: string | undefined = process.env["SystemRoot"],
	exists: (p: string) => boolean = existsSync,
): { found: true; path: string } | { found: false; path: string } {
	const path = resolveWindowsSystemTool(toolRelativePath, systemRoot)
	return exists(path) ? { found: true, path } : { found: false, path }
}

