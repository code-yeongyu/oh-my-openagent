import { readdirSync, statSync, type Stats } from "node:fs"
import { join } from "node:path"

const SCANNED = /\.(?:css|scss|less|pcss|postcss|html?|[cm]?[jt]sx?|vue|svelte|astro)$/i
const SKIPPED_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".astro",
	".turbo", ".cache", "coverage", "vendor", ".vercel", ".output",
])
const MAX_BYTES = 1_000_000

function statOrNull(path: string): Stats | null {
	try {
		return statSync(path)
	} catch {
		return null
	}
}

function entriesOrNull(path: string): string[] | null {
	try {
		return readdirSync(path)
	} catch {
		return null
	}
}

/** Lintable source files under the targets; dangling links and unreadable entries are skipped, an unreadable explicit target is reported. */
export function collectFiles(targets: readonly string[]): { readonly paths: string[]; readonly missing: string[] } {
	const paths: string[] = []
	const missing: string[] = []
	const walk = (path: string, explicit: boolean): void => {
		const stat = statOrNull(path)
		if (!stat) {
			if (explicit) missing.push(path)
			return
		}
		if (stat.isDirectory()) {
			const entries = entriesOrNull(path)
			if (entries === null) {
				if (explicit) missing.push(path)
				return
			}
			for (const entry of entries) {
				if (!SKIPPED_DIRS.has(entry)) walk(join(path, entry), false)
			}
			return
		}
		const minified = /\.min\.[a-z]+$/i.test(path) || path.endsWith(".d.ts")
		if (SCANNED.test(path) && !minified && stat.size <= MAX_BYTES) paths.push(path)
	}
	for (const target of targets) walk(target, true)
	return { paths, missing }
}
