// script/omob-senpi-workspace-reset.ts
// The omob senpi cache clone is reused across builds and `ensureCacheClone` runs `git clean -ffd`
// without `-x`, so ignored directories survive. senpi's publish staging
// (scripts/prepare-senpi-bundled-workspaces.mjs) copies whole bundled workspaces into
// packages/coding-agent/node_modules and writes packages/coding-agent/vendor; senpi documents that
// as safe only for a disposable checkout. Left in place, the previous build's copies shadow the
// workspace links the next build's bundler must resolve, so discard them before every install.

import { lstatSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const STAGED_ARTIFACT_PATHS: readonly string[] = [join("packages", "coding-agent", "vendor")]

function pathExists(path: string): boolean {
	try {
		lstatSync(path)
		return true
	} catch {
		return false
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory()
	} catch {
		return false
	}
}

function segmentMatcher(segment: string): (name: string) => boolean {
	const pattern = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
	const matcher = new RegExp(`^${pattern}$`)
	return (name) => matcher.test(name)
}

function declaredGlobs(workspaces: unknown): readonly string[] {
	const entries = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages
	if (!Array.isArray(entries)) return []
	return entries.filter((entry): entry is string => typeof entry === "string")
}

function expandWorkspaceGlob(senpiRoot: string, glob: string): readonly string[] {
	let current: readonly string[] = [senpiRoot]
	for (const segment of glob.split("/").filter((part) => part.length > 0 && part !== ".")) {
		const next: string[] = []
		for (const directory of current) {
			if (!segment.includes("*")) {
				const candidate = join(directory, segment)
				if (isDirectory(candidate)) next.push(candidate)
				continue
			}
			const matches = segmentMatcher(segment)
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue
				if (!matches(entry.name)) continue
				const candidate = join(directory, entry.name)
				if (isDirectory(candidate)) next.push(candidate)
			}
		}
		current = next
	}
	return current.filter((directory) => directory !== senpiRoot)
}

/**
 * Directories the senpi root's `workspaces` globs resolve to, in declaration order. A checkout
 * without a manifest declares no workspaces: this unit discards residue, and a clone too broken
 * to build is rejected later by the install and lock steps that need it.
 */
export function resolveSenpiWorkspaceDirs(senpiRoot: string): readonly string[] {
	const manifestPath = join(senpiRoot, "package.json")
	if (!pathExists(manifestPath)) return []
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { workspaces?: unknown }
	const directories = new Set<string>()
	for (const glob of declaredGlobs(manifest.workspaces)) {
		for (const directory of expandWorkspaceGlob(senpiRoot, glob)) directories.add(directory)
	}
	return [...directories]
}

/**
 * Deletes every workspace-local install and staged vendor tree in a senpi checkout and returns
 * what it removed, relative to `senpiRoot`. The root install is bun's to manage and is never
 * touched, and nothing tracked by git is removed.
 */
export function resetSenpiWorkspaceInstalls(senpiRoot: string): readonly string[] {
	const rootInstall = join(senpiRoot, "node_modules")
	const targets = [
		...resolveSenpiWorkspaceDirs(senpiRoot).map((directory) => join(directory, "node_modules")),
		...STAGED_ARTIFACT_PATHS.map((path) => join(senpiRoot, path)),
	]
	const removed: string[] = []
	for (const target of new Set(targets)) {
		if (target === rootInstall) continue
		if (!pathExists(target)) continue
		rmSync(target, { recursive: true, force: true })
		removed.push(relative(senpiRoot, target))
	}
	return removed.sort()
}
