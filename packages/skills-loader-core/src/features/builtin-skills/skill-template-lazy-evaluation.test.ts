import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

// Issue #6635: builtin skill modules that call loadSharedSkillTemplate() in a module-scope
// object literal force a readFileSync during bundle evaluation. When the shared skills tree
// is absent next to the built bundle (OpenCode Desktop Node sidecar, partial installs), the
// ENOENT thrown at import time makes the whole dist/index.js ESM import fail and the plugin
// host silently drops the plugin. Templates must therefore be resolved lazily (getter), so
// module evaluation never touches the filesystem.

const SKILLS_DIR = new URL("./skills", import.meta.url).pathname

const EAGER_TEMPLATE_PATTERN = /template:\s*loadSharedSkillTemplate\(/

async function listSkillModulesWithEagerTemplates(): Promise<string[]> {
	const files = readdirSync(SKILLS_DIR).filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
	)
	const eager: string[] = []
	for (const file of files) {
		const source = await Bun.file(join(SKILLS_DIR, file)).text()
		if (EAGER_TEMPLATE_PATTERN.test(source)) eager.push(file)
	}
	return eager
}

describe("builtin skill template lazy evaluation", () => {
	test("#given builtin skill modules #when scanned for template initialization #then no module-scope loadSharedSkillTemplate call remains", async () => {
		// when
		const eagerModules = await listSkillModulesWithEagerTemplates()

		// then
		expect(eagerModules).toEqual([])
	})
})
