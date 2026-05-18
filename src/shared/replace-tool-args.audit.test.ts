import { describe, it, expect } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

const SRC_DIR = join(import.meta.dir, "..")

async function collectTsFiles(dir: string): Promise<string[]> {
	const results: string[] = []
	const entries = await readdir(dir, { withFileTypes: true })

	for (const entry of entries) {
		const fullPath = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue
			results.push(...(await collectTsFiles(fullPath)))
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".audit.test.ts")) {
			results.push(fullPath)
		}
	}

	return results
}

const HELPER_FILE = "shared/replace-tool-args.ts"

const DIRECT_MUTATION_PATTERN = /output\.args\.\w+\s*=[^=]/g
const OBJECT_ASSIGN_PATTERN = /Object\.assign\(\s*output\.args/g

describe("replace-tool-args audit", () => {
	it("#given src/**/*.ts files #when scanning for direct output.args mutation #then no matches found outside the helper", async () => {
		// given
		const files = await collectTsFiles(SRC_DIR)
		const violations: string[] = []

		// when
		for (const file of files) {
			const relPath = relative(SRC_DIR, file)
			if (relPath === HELPER_FILE) continue

			const content = await readFile(file, "utf-8")
			const lines = content.split("\n")

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				if (DIRECT_MUTATION_PATTERN.test(line)) {
					violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
				}
				DIRECT_MUTATION_PATTERN.lastIndex = 0

				if (OBJECT_ASSIGN_PATTERN.test(line)) {
					violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
				}
				OBJECT_ASSIGN_PATTERN.lastIndex = 0
			}
		}

		// then
		expect(violations).toEqual([])
	})
})
