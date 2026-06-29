/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "bun"

import {
	isZipInfoZipListingAvailable,
	listZipEntriesWithZipInfo,
	parseZipInfoListedEntry,
} from "./zipinfo-zip-entry-listing"

const testDirs: string[] = []

function isCommandAvailable(command: string): boolean {
	return spawnSync(["which", command], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
}

function createTestDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "zipinfo-entry-listing-"))
	testDirs.push(dir)
	return dir
}

afterEach(() => {
	for (const dir of testDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe("parseZipInfoListedEntry", () => {
	describe("#given a zipinfo listing line with trailing filename whitespace", () => {
		it("#when parsing the line #then preserves the original trailing whitespace", () => {
			// given
			const listedLine =
				"?rw-------  2.0 unx        1 b-        1 stor 26-Apr-03 18:33   trailing-space.txt "

			// when
			const parsedEntry = parseZipInfoListedEntry(listedLine)

			// then
			expect(parsedEntry).toEqual({
				path: "trailing-space.txt ",
				type: "file",
			})
		})
	})
})

describe.skipIf(!isCommandAvailable("python3") || !isCommandAvailable("unzip") || !isZipInfoZipListingAvailable())(
	"listZipEntriesWithZipInfo",
	() => {
		it("#given a symlink entry name with a wildcard metacharacter #when listing #then reads only the exact symlink target", async () => {
			// given
			const rootDir = createTestDir()
			const archivePath = join(rootDir, "wildcard-symlink.zip")
			const scriptPath = join(rootDir, "make-wildcard-symlink.py")
			writeFileSync(
				scriptPath,
				[
					"import stat",
					"import sys",
					"import zipfile",
					"archive = zipfile.ZipFile(sys.argv[1], 'w')",
					"entry = zipfile.ZipInfo('bin/*')",
					"entry.create_system = 3",
					"entry.external_attr = (stat.S_IFLNK | 0o777) << 16",
					"archive.writestr(entry, '../../escape.txt')",
					"archive.writestr('bin/x', 'wrong-target')",
					"archive.close()",
				].join("\n")
			)
			const result = spawnSync(["python3", scriptPath, archivePath], { stdout: "pipe", stderr: "pipe" })
			if (result.exitCode !== 0) {
				throw new Error(result.stderr.toString())
			}

			// when
			const entries = await listZipEntriesWithZipInfo(archivePath)

			// then
			expect(entries.find(entry => entry.path === "bin/*")).toEqual({
				path: "bin/*",
				type: "symlink",
				linkPath: "../../escape.txt",
			})
		})
	}
)
