/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { validateArchiveEntries } from "./archive-entry-validator"

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
