import { readdirSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

import { languageFor } from "./tags"

const MAX_FILE_BYTES = 1024 * 1024
const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", "dist", "build", "target", "out", "coverage", "vendor", "__pycache__", ".venv", "venv"])

function gitListFiles(root: string, paths: readonly string[]): string[] | null {
	const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...paths], { stdout: "pipe", stderr: "ignore" })
	if (result.exitCode !== 0) return null
	return result.stdout.toString().split("\0").filter((entry) => entry.length > 0).map((entry) => join(root, entry))
}

function insideGitWorkTree(root: string): boolean {
	const result = Bun.spawnSync(["git", "-C", root, "rev-parse", "--is-inside-work-tree"], { stdout: "pipe", stderr: "ignore" })
	return result.exitCode === 0 && result.stdout.toString().trim() === "true"
}

function walk(path: string, out: string[]): void {
	let entries: string[]
	try {
		entries = readdirSync(path)
	} catch {
		return
	}
	for (const name of entries.sort()) {
		if (name.startsWith(".") || SKIPPED_DIRS.has(name)) continue
		const child = join(path, name)
		let stat: ReturnType<typeof statSync>
		try {
			stat = statSync(child)
		} catch {
			continue
		}
		if (stat.isDirectory()) walk(child, out)
		else if (stat.isFile()) out.push(child)
	}
}

function mappable(path: string): boolean {
	if (languageFor(path) === null) return false
	try {
		const stat = statSync(path)
		return stat.isFile() && stat.size > 0 && stat.size <= MAX_FILE_BYTES
	} catch {
		return false
	}
}

export function discoverFiles(paths: readonly string[], cwd: string): string[] {
	const absolute = paths.map((path) => (isAbsolute(path) ? path : resolve(cwd, path)))
	const fromGit = insideGitWorkTree(cwd) ? gitListFiles(cwd, absolute) : null
	const candidates: string[] = []
	if (fromGit !== null) candidates.push(...fromGit)
	else {
		for (const path of absolute) {
			let stat: ReturnType<typeof statSync>
			try {
				stat = statSync(path)
			} catch {
				continue
			}
			if (stat.isDirectory()) walk(path, candidates)
			else candidates.push(path)
		}
	}
	return [...new Set(candidates)].filter((path) => !path.split(/[\\/]/).some((segment) => SKIPPED_DIRS.has(segment))).filter(mappable).sort()
}
