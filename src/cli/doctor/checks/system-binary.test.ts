import { describe, expect, test } from "bun:test"
import { compareVersions } from "./system-binary"

describe("compareVersions", () => {
	describe("#given numeric semver inputs", () => {
		test("#then 1.14.33 is recognized as >= 1.4.0", () => {
			expect(compareVersions("1.14.33", "1.4.0")).toBe(true)
		})

		test("#then 1.4.0 satisfies 1.4.0", () => {
			expect(compareVersions("1.4.0", "1.4.0")).toBe(true)
		})

		test("#then 1.3.99 fails 1.4.0", () => {
			expect(compareVersions("1.3.99", "1.4.0")).toBe(false)
		})
	})

	describe("#given OpenCode Desktop log-style stdout containing the version", () => {
		test("#then the embedded 1.14.33 is extracted and compared correctly (fixes #3765)", () => {
			const desktopOutput = "00:24:25.202 > app starting { version: '1.14.33', packaged: true }"
			expect(compareVersions(desktopOutput, "1.4.0")).toBe(true)
		})

		test("#then a multi-line log containing only the version is handled", () => {
			const multiline = "Some preamble\nopencode 1.14.33\nMore text"
			expect(compareVersions(multiline, "1.4.0")).toBe(true)
		})
	})
})
