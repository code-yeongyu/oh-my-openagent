import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when the module identified by `importMetaUrl` is the process CLI
 * entrypoint (`node <script>`).
 *
 * A plain `import.meta.url === pathToFileURL(process.argv[1]).href` check
 * breaks when the script is reached through a symlink: Node resolves
 * `import.meta.url` to the real path by default, while `process.argv[1]`
 * keeps the symlinked spelling, so the two never match and the CLI body is
 * silently skipped (exit 0, no output). Seen in the wild with a symlinked
 * plugin cache dir, which turned every SessionStart hook into a no-op.
 *
 * @param {string} importMetaUrl the caller's `import.meta.url`
 */
export function isCliEntry(importMetaUrl) {
	const argv1 = process.argv[1];
	if (argv1 === undefined) return false;
	if (importMetaUrl === pathToFileURL(argv1).href) return true;
	try {
		return importMetaUrl === pathToFileURL(realpathSync(argv1)).href;
	} catch {
		return false;
	}
}
