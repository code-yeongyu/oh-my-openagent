// Contract tests for script/omob-senpi-workspace-reset.ts.

import { describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { resetSenpiWorkspaceInstalls } from "./omob-senpi-workspace-reset"

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix))
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(value, undefined, "\t")}\n`)
}

/**
 * A reusable senpi cache clone as the previous build left it: prepare-senpi-bundled-workspaces.mjs
 * staged full copies of the bundled workspaces under packages/coding-agent/node_modules and wrote
 * packages/coding-agent/vendor, and `git clean -ffd` (no -x) left all of it in place.
 */
function stagedSenpiClone(): string {
	const root = tempDir("omob-senpi-reset-")
	writeJson(join(root, "package.json"), { name: "senpi-monorepo", private: true, workspaces: ["packages/*", "packages/session-backends/*"] })
	writeJson(join(root, "packages", "agent", "package.json"), { name: "@earendil-works/pi-agent-core", version: "2026.9.18-6" })
	writeJson(join(root, "packages", "coding-agent", "package.json"), { name: "@code-yeongyu/senpi", version: "2026.9.18-6" })
	writeJson(join(root, "packages", "coding-agent", "node_modules", "@earendil-works", "pi-agent-core", "package.json"), {
		name: "@earendil-works/pi-agent-core",
		version: "2026.9.16-3",
	})
	writeJson(join(root, "packages", "coding-agent", "node_modules", "zod", "package.json"), { name: "zod", version: "3.25.0" })
	mkdirSync(join(root, "packages", "coding-agent", "vendor", "pi-client"), { recursive: true })
	writeFileSync(join(root, "packages", "coding-agent", "vendor", "pi-client", "index.js"), "module.exports = {}\n")
	writeJson(join(root, "packages", "session-backends", "sqlite-node", "node_modules", "x", "package.json"), { name: "x", version: "1.0.0" })
	mkdirSync(join(root, "packages", "coding-agent", "src"), { recursive: true })
	writeFileSync(join(root, "packages", "coding-agent", "src", "index.ts"), "export const marker = 1\n")
	mkdirSync(join(root, "node_modules", "@earendil-works"), { recursive: true })
	symlinkSync(join("..", "..", "packages", "agent"), join(root, "node_modules", "@earendil-works", "pi-agent-core"))
	return root
}

describe("resetSenpiWorkspaceInstalls", () => {
	test("#given a clone carrying the previous build's publish staging #when the reset runs #then every workspace install and the vendor dir are gone", () => {
		const root = stagedSenpiClone()
		try {
			const removed = resetSenpiWorkspaceInstalls(root)

			expect(existsSync(join(root, "packages", "coding-agent", "node_modules"))).toBe(false)
			expect(existsSync(join(root, "packages", "coding-agent", "vendor"))).toBe(false)
			expect(existsSync(join(root, "packages", "session-backends", "sqlite-node", "node_modules"))).toBe(false)
			expect(removed.slice().sort()).toEqual([
				join("packages", "coding-agent", "node_modules"),
				join("packages", "coding-agent", "vendor"),
				join("packages", "session-backends", "sqlite-node", "node_modules"),
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("#given the root install and tracked sources #when the reset runs #then neither is touched", () => {
		const root = stagedSenpiClone()
		try {
			resetSenpiWorkspaceInstalls(root)

			const rootLink = join(root, "node_modules", "@earendil-works", "pi-agent-core")
			expect(lstatSync(rootLink).isSymbolicLink()).toBe(true)
			expect(readlinkSync(rootLink)).toBe(join("..", "..", "packages", "agent"))
			expect(JSON.parse(readFileSync(join(root, "packages", "agent", "package.json"), "utf8")).version).toBe("2026.9.18-6")
			expect(readFileSync(join(root, "packages", "coding-agent", "src", "index.ts"), "utf8")).toBe("export const marker = 1\n")
			expect(existsSync(join(root, "packages", "coding-agent", "package.json"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("#given an already clean clone #when the reset runs again #then it removes nothing and does not throw", () => {
		const root = stagedSenpiClone()
		try {
			resetSenpiWorkspaceInstalls(root)

			expect(resetSenpiWorkspaceInstalls(root)).toEqual([])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("#given a workspace glob that matches nothing #when the reset runs #then it removes nothing", () => {
		const root = tempDir("omob-senpi-reset-empty-")
		try {
			writeJson(join(root, "package.json"), { name: "senpi-monorepo", private: true, workspaces: ["packages/*"] })

			expect(resetSenpiWorkspaceInstalls(root)).toEqual([])
			expect(existsSync(join(root, "package.json"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("#given a checkout without a manifest #when the reset runs #then it removes nothing and does not throw", () => {
		const root = tempDir("omob-senpi-reset-bare-")
		try {
			expect(resetSenpiWorkspaceInstalls(root)).toEqual([])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
