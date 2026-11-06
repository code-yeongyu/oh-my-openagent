/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "bun"

import { extractTarGz } from "./binary-downloader"
import { validateArchiveEntries } from "./archive-entry-validator"
import { extractZip } from "./zip-extractor"

const testDirs: string[] = []

function createTestDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "archive-entry-validator-"))
	testDirs.push(dir)
	return dir
}

function runPythonScript(scriptPath: string, args: readonly string[], cwd?: string): void {
	const result = spawnSync(["python3", scriptPath, ...args], { cwd, stderr: "pipe", stdout: "pipe" })
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString())
	}
}

function writePythonScript(dir: string, filename: string, content: string): string {
	const scriptPath = join(dir, filename)
	writeFileSync(scriptPath, content)
	return scriptPath
}

afterEach(() => {
	for (const dir of testDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe("validateArchiveEntries", () => {
	it("rejects absolute paths and traversal entries", () => {
		//#given
		const destDir = "/tmp/archive-root"

		//#when
		const rejectAbsolutePath = () =>
			validateArchiveEntries([{ path: "/etc/passwd", type: "file" }], destDir)
		const rejectTraversalPath = () =>
			validateArchiveEntries([{ path: "nested/../../evil.txt", type: "file" }], destDir)

		//#then
		expect(rejectAbsolutePath).toThrow(/absolute path/i)
		expect(rejectTraversalPath).toThrow(/path traversal/i)
	})

	it("rejects symlink targets that escape the extraction directory", () => {
		//#given
		const destDir = "/tmp/archive-root"

		//#when
		const rejectEscapeSymlink = () =>
			validateArchiveEntries(
				[{ path: "bin/tool", type: "symlink", linkPath: "../../outside/tool" }],
				destDir
			)

		//#then
		expect(rejectEscapeSymlink).toThrow(/symlink target/i)
	})

	it("rejects hard-link targets that escape the extraction directory", () => {
		//#given
		const destDir = "/tmp/archive-root"

		//#when
		const rejectEscapeHardLink = () =>
			validateArchiveEntries(
				[{ path: "bin/tool", type: "hardlink", linkPath: "../../etc/passwd" }],
				destDir
			)

		//#then
		expect(rejectEscapeHardLink).toThrow(/hard link target/i)
	})

	it("accepts contained files, directories, and symlinks", () => {
		//#given
		const destDir = "/tmp/archive-root"
		const entries = [
			{ path: "bin/", type: "directory" as const },
			{ path: "bin/tool", type: "file" as const },
			{ path: "bin/tool-link", type: "symlink" as const, linkPath: "tool" },
		]

		//#when
		const validateContainedEntries = () => validateArchiveEntries(entries, destDir)

		//#then
		expect(validateContainedEntries).not.toThrow()
	})
})

// The 3 tests in this block spawn `python3` to create malicious archive
// fixtures. The Windows CI runner (windows-latest) does not have Python
// preinstalled, so `spawnSync(["python3", ...])` hangs until the 5000ms
// per-test timeout. The 4 sibling tests in the `validateArchiveEntries`
// describe above still cover the validation logic (rejects absolute paths,
// traversal entries, symlink targets, hard-link targets, accepts contained
// entries); these 3 tests are end-to-end integration tests that verify the
// same logic on actual archive bytes. macOS and Linux runners have Python
// installed and still run the full block.
describe.skipIf(process.platform === "win32")("archive extraction preflight", () => {
	it("rejects tar archives with traversal entries before extraction", async () => {
		//#given
		const rootDir = createTestDir()
		const archivePath = join(rootDir, "malicious.tar.gz")
		const destDir = join(rootDir, "dest")
		mkdirSync(destDir, { recursive: true })
		const scriptPath = writePythonScript(
			rootDir,
			"make-malicious-tar.py",
			[
				"import io",
				"import sys",
				"import tarfile",
				"with tarfile.open(sys.argv[1], 'w:gz') as archive:",
				"    data = b'owned'",
				"    info = tarfile.TarInfo('../escape.txt')",
				"    info.size = len(data)",
				"    archive.addfile(info, io.BytesIO(data))",
			].join("\n")
		)
		runPythonScript(scriptPath, [archivePath])

		//#when
		let errorMessage = ""
		try {
			await extractTarGz(archivePath, destDir)
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error)
		}

		//#then
		expect(errorMessage).toMatch(/path traversal/i)
	})

	it("rejects tar archives with hard-link traversal before extraction", async () => {
		//#given
		const rootDir = createTestDir()
		const archivePath = join(rootDir, "malicious-hard-link.tar.gz")
		const destDir = join(rootDir, "dest")
		mkdirSync(destDir, { recursive: true })
		const scriptPath = writePythonScript(
			rootDir,
			"make-malicious-hard-link-tar.py",
			[
				"import sys",
				"import tarfile",
				"with tarfile.open(sys.argv[1], 'w:gz') as archive:",
				"    info = tarfile.TarInfo('bin/tool')",
				"    info.type = tarfile.LNKTYPE",
				"    info.linkname = '../../etc/passwd'",
				"    archive.addfile(info)",
			].join("\n")
		)
		runPythonScript(scriptPath, [archivePath])

		//#when
		let errorMessage = ""
		try {
			await extractTarGz(archivePath, destDir)
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error)
		}

		//#then
		expect(errorMessage).toMatch(/hard link target|path traversal/i)
	})

	it("rejects zip archives with symlink escapes before extraction", async () => {
		//#given
		const rootDir = createTestDir()
		const archivePath = join(rootDir, "malicious.zip")
		const destDir = join(rootDir, "dest")
		mkdirSync(destDir, { recursive: true })
		const scriptPath = writePythonScript(
			rootDir,
			"make-malicious-zip.py",
			[
				"import stat",
				"import sys",
				"import zipfile",
				"archive = zipfile.ZipFile(sys.argv[1], 'w')",
				"entry = zipfile.ZipInfo('bin/tool-link')",
				"entry.create_system = 3",
				"entry.external_attr = (stat.S_IFLNK | 0o777) << 16",
				"archive.writestr(entry, '../../escape.txt')",
				"archive.close()",
			].join("\n")
		)
		runPythonScript(scriptPath, [archivePath])

		//#when
		let errorMessage = ""
		try {
			await extractZip(archivePath, destDir)
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error)
		}

		//#then
		expect(errorMessage).toMatch(/symlink target/i)
	})

	it("extracts safe tar and zip archives into the destination directory", async () => {
		//#given
		const rootDir = createTestDir()
		const sourceDir = join(rootDir, "source")
		const tarArchivePath = join(rootDir, "safe.tar.gz")
		const zipArchivePath = join(rootDir, "safe.zip")
		const tarDestDir = join(rootDir, "tar-dest")
		const zipDestDir = join(rootDir, "zip-dest")
		mkdirSync(join(sourceDir, "bin"), { recursive: true })
		mkdirSync(tarDestDir, { recursive: true })
		mkdirSync(zipDestDir, { recursive: true })
		writeFileSync(join(sourceDir, "bin", "tool.txt"), "safe")
		symlinkSync("tool.txt", join(sourceDir, "bin", "tool-link"))
		const tarScriptPath = writePythonScript(
			rootDir,
			"make-safe-tar.py",
			[
				"import sys",
				"import tarfile",
				"archive_path, source_dir = sys.argv[1], sys.argv[2]",
				"with tarfile.open(archive_path, 'w:gz') as archive:",
				"    archive.add(source_dir, arcname='.')",
			].join("\n")
		)
		const zipScriptPath = writePythonScript(
			rootDir,
			"make-safe-zip.py",
			[
				"import sys",
				"import zipfile",
				"archive_path, source_dir = sys.argv[1], sys.argv[2]",
				"with zipfile.ZipFile(archive_path, 'w') as archive:",
				"    archive.write(source_dir + '/bin/tool.txt', 'bin/tool.txt')",
				"    info = zipfile.ZipInfo('bin/tool-link')",
				"    info.create_system = 3",
				"    info.external_attr = 0o120777 << 16",
				"    archive.writestr(info, 'tool.txt')",
			].join("\n")
		)
		runPythonScript(tarScriptPath, [tarArchivePath, sourceDir])
		runPythonScript(zipScriptPath, [zipArchivePath, sourceDir])

		//#when
		await extractTarGz(tarArchivePath, tarDestDir)
		await extractZip(zipArchivePath, zipDestDir)

		//#then
		expect(readFileSync(join(tarDestDir, "bin", "tool.txt"), "utf8")).toBe("safe")
		expect(readFileSync(join(zipDestDir, "bin", "tool.txt"), "utf8")).toBe("safe")
		expect(lstatSync(join(tarDestDir, "bin", "tool-link")).isSymbolicLink()).toBe(true)
		expect(lstatSync(join(zipDestDir, "bin", "tool-link")).isSymbolicLink()).toBe(true)
	})
})

// `tar -tvzf` output depends on the tar and the locale. bsdtar prints the month in the system locale:
// Windows keeps it before the day ("сен 30"), macOS orders it by locale ("30 сент." under ru_RU), and some
// month names are two words ("10-р сар" under mn_MN, "تشرين الأول" under ar_JO). GNU tar prints
// "owner/group size YYYY-MM-DD HH:MM" with no link count. The extraction runs in a child
// process whose PATH starts with a stand-in `tar` printing one such line (a spawned child only sees the
// environment it is given), so the entry parser sees the bytes those systems emit. Like GNU tar, the
// stand-in prefixes lines for TAR_OPTIONS=--block-number and translates " link to " when LANGUAGE is set
// outside the C locale, and like both tars it prints owner and group names as stored unless
// --numeric-owner is passed. The archive bytes are not a tar, so a run that reached the real tar would
// fail its listing instead of passing. POSIX-only: the stand-in is a shell script.
describe.skipIf(process.platform === "win32")("tar listing layouts", () => {
	it.each([
		[
			"rejects an escaping symlink listed with a localized month first (Windows bsdtar)",
			"lrwxr-xr-x  0 0      0           0 сен 30 12:00 bin/tool -> ../../escape",
			/symlink target/i,
		],
		[
			"rejects an escaping symlink listed with a localized day first (macOS bsdtar, ru_RU)",
			"lrwxr-xr-x  0 0      0           0 30 сент. 12:00 bin/tool -> ../../escape",
			/symlink target/i,
		],
		[
			"rejects an escaping symlink listed with a two-word month first (macOS bsdtar, mn_MN)",
			"lrwxr-xr-x  0 0      0           0 10-р сар  8 21:00 bin/tool -> ../../escape",
			/symlink target/i,
		],
		[
			"extracts a contained symlink listed with a two-word month after the day (macOS bsdtar, ar_JO)",
			"lrwxr-xr-x  0 0      0           0  8 تشرين الأول 21:00 bin/link -> tool",
			/^resolved$/m,
		],
		[
			"rejects an escaping symlink listed in GNU tar's layout",
			"lrwxr-xr-x user/group     0 2026-10-08 20:47 bin/link -> ../../escape",
			/symlink target/i,
		],
		[
			"rejects an escaping hard link listed in GNU tar's layout",
			"hrw-r--r-- 0/0               0 2026-10-08 20:47 bin/hard link to ../../outside.txt",
			/hard link target/i,
		],
		[
			"extracts a contained hard link listed in GNU tar's layout",
			"hrw-r--r-- 0/0               0 2026-10-08 20:47 bin/hard link to bin/tool",
			/^resolved$/m,
		],
		[
			"extracts a contained hard link when the environment asks GNU tar for translated messages",
			"hrw-r--r-- 0/0               0 2026-10-08 20:47 bin/hard link to bin/tool",
			/^resolved$/m,
			{ LANGUAGE: "de", LC_ALL: "" },
		],
		[
			"ignores TAR_OPTIONS that change GNU tar's listing layout",
			"lrwxr-xr-x user/group     0 2026-10-08 20:47 bin/link -> ../../escape",
			/symlink target/i,
			{ TAR_OPTIONS: "--block-number" },
		],
		[
			"extracts a file whose owner and group names contain spaces (GNU tar layout)",
			"-rw-r--r-- {gnu-owner}     1 2026-10-08 20:47 bin/tool",
			/^resolved$/m,
		],
		[
			"extracts a file whose owner and group names contain spaces (bsdtar layout)",
			"-rw-r--r--  0 {bsd-owner} 1 Oct  8 20:47 bin/tool",
			/^resolved$/m,
		],
		[
			"refuses to extract when a link line contains its separator more than once",
			"lrwxr-xr-x user/group     0 2026-10-08 20:47 bin/link -> /etc -> safe",
			/could not be parsed/i,
		],
		[
			"refuses to extract when a listing line has an unknown layout",
			"?rw-r--r-- an unrecognized listing layout bin/tool",
			/could not be parsed/i,
		],
	])("%s", (_name, listingLine, expected, extraEnv: Record<string, string> = {}) => {
		//#given
		const rootDir = createTestDir()
		const archivePath = join(rootDir, "localized-listing.tar.gz")
		writeFileSync(archivePath, "not a tar archive")
		const destDir = join(rootDir, "dest")
		mkdirSync(destDir)
		const binDir = join(rootDir, "fake-bin")
		mkdirSync(binDir)
		const listingPath = join(rootDir, "listing.txt")
		writeFileSync(listingPath, `${listingLine}\n`)
		const fakeTar = join(binDir, "tar")
		writeFileSync(
			fakeTar,
			[
				"#!/bin/sh",
				'case " $* " in *" -tvzf "*) ;; *) exit 0 ;; esac',
				`line=$(cat '${listingPath}')`,
				'case " $* " in *" --numeric-owner "*) gnu="1000/1001"; bsd="1000   1001" ;; *) gnu="John Doe/Domain Users"; bsd="John Doe Domain Users" ;; esac',
				'line=$(printf "%s\\n" "$line" | sed -e "s#{gnu-owner}#$gnu#" -e "s#{bsd-owner}#$bsd#")',
				'if [ "${LC_ALL:-}" != "C" ] && [ -n "${LANGUAGE:-}" ]; then line=$(printf "%s\\n" "$line" | sed "s/ link to / Verknüpfung zu /"); fi',
				'case " ${TAR_OPTIONS:-} " in *" --block-number "*) line="block 0: $line" ;; esac',
				'printf "%s\\n" "$line"',
			].join("\n"),
		)
		chmodSync(fakeTar, 0o755)
		const driver = [
			`const { extractTarGz } = await import(${JSON.stringify(join(import.meta.dir, "binary-downloader.ts"))})`,
			"try {",
			"\tawait extractTarGz(process.env.LOCALIZED_TAR_ARCHIVE, process.env.LOCALIZED_TAR_DEST)",
			'\tconsole.log("resolved")',
			"} catch (error) {",
			"\tconsole.log(error instanceof Error ? error.message : String(error))",
			"}",
		].join("\n")

		//#when
		const result = spawnSync([process.execPath, "-e", driver], {
			env: {
				...process.env,
				PATH: `${binDir}:${process.env.PATH ?? ""}`,
				LOCALIZED_TAR_ARCHIVE: archivePath,
				LOCALIZED_TAR_DEST: destDir,
				...extraEnv,
			},
			stdout: "pipe",
			stderr: "pipe",
			timeout: 10_000,
		})

		//#then
		expect(result.stdout.toString()).toMatch(expected)
	})
})
