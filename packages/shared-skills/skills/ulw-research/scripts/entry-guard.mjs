import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * True when the module at `importMetaUrl` is the process entrypoint (`node <script>`).
 * Compares against the realpath too: Node resolves import.meta.url through symlinks while
 * process.argv[1] keeps the symlinked spelling, so a plain equality check silently skips the CLI
 * body when the skill is reached through a symlinked plugin directory.
 *
 * @param {string} importMetaUrl the caller's import.meta.url
 */
export function isCliEntry(importMetaUrl) {
	const argv1 = process.argv[1]
	if (argv1 === undefined) return false
	if (importMetaUrl === pathToFileURL(argv1).href) return true
	try {
		return importMetaUrl === pathToFileURL(realpathSync(argv1)).href
	} catch {
		return false
	}
}
