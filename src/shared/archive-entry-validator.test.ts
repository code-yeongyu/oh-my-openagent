/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

function runCommand(command: string, cwd?: string): void {
	const result = spawnSync(["bash", "-lc", command], { cwd, stderr: "pipe", stdout: "pipe" })
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

describe("archive extraction preflight", () => {
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
		runCommand(`python3 "${scriptPath}" "${archivePath}"`)

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
		runCommand(`python3 "${scriptPath}" "${archivePath}"`)

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
		runCommand(`python3 "${scriptPath}" "${archivePath}"`)

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
		runCommand(`tar -czf "${tarArchivePath}" -C "${sourceDir}" .`)
		runCommand(`zip -qry "${zipArchivePath}" .`, sourceDir)

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
