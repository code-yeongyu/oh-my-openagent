import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { collectFiles } from "./collect-files"

// Owner test for the file-walk contract both perfection CLIs share (check-accent-stripes.ts, check-draft-guard.ts).
function withDir(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "collect-files-"))
	try {
		run(dir)
	} finally {
		chmodSync(dir, 0o700)
		rmSync(dir, { recursive: true, force: true })
	}
}

// Permission bits do not stop root, and Windows ignores chmod, so the unreadable-directory case cannot be built there.
const cannotBuildUnreadableDir = process.platform === "win32" || process.getuid?.() === 0

describe("#given a scanned directory", () => {
	test("#when it holds a dangling symlink #then the link is skipped and the rest is collected", () => {
		withDir((dir) => {
			symlinkSync(join(dir, "missing-target"), join(dir, "broken-link.tsx"))
			writeFileSync(join(dir, "page.html"), "<p>ok</p>\n")
			expect(collectFiles([dir])).toEqual({ paths: [join(dir, "page.html")], missing: [] })
		})
	})

	test.skipIf(cannotBuildUnreadableDir)("#when a nested directory cannot be listed #then it is skipped and the rest is collected", () => {
		withDir((dir) => {
			const locked = join(dir, "locked")
			mkdirSync(locked)
			writeFileSync(join(locked, "hidden.css"), ".a {}\n")
			writeFileSync(join(dir, "page.html"), "<p>ok</p>\n")
			chmodSync(locked, 0o000)
			try {
				expect(collectFiles([dir])).toEqual({ paths: [join(dir, "page.html")], missing: [] })
			} finally {
				chmodSync(locked, 0o700)
			}
		})
	})

	test("#when an explicit target does not exist #then it is reported as missing", () => {
		withDir((dir) => {
			expect(collectFiles([join(dir, "nope")])).toEqual({ paths: [], missing: [join(dir, "nope")] })
		})
	})
})
