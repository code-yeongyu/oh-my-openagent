import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Guardrail: the Claude Code marketplace publish workflow must NEVER deploy
// without an explicit, gated, human-triggered action. This test pins the
// "no accidental publish" invariants so a future edit can't silently re-arm it.
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "publish-claude.yml")
const yaml = readFileSync(WORKFLOW, "utf8")

// Isolate the `on:` trigger block (everything before the first top-level `jobs:`).
const triggerBlock = yaml.slice(0, yaml.search(/^jobs:/m) === -1 ? yaml.length : yaml.search(/^jobs:/m))

describe("publish-claude.yml is off by default", () => {
	test("the only trigger is workflow_dispatch (no push/pull_request/schedule/tags)", () => {
		expect(triggerBlock).toMatch(/workflow_dispatch:/)
		expect(triggerBlock).not.toMatch(/^\s*push:/m)
		expect(triggerBlock).not.toMatch(/^\s*pull_request:/m)
		expect(triggerBlock).not.toMatch(/^\s*schedule:/m)
		expect(triggerBlock).not.toMatch(/^\s*tags:/m)
	})

	test("every job is guarded to the canonical repository identity", () => {
		expect(yaml).toMatch(/github\.repository == 'code-yeongyu\/oh-my-openagent'/)
	})

	test("a missing LAZYCLAUDECODE_SYNC_TOKEN hard-fails the publish", () => {
		expect(yaml).toContain("LAZYCLAUDECODE_SYNC_TOKEN")
		// The gate must combine an empty-token condition with a non-zero exit.
		expect(yaml).toMatch(/LAZYCLAUDECODE_SYNC_TOKEN == ''/)
		expect(yaml).toMatch(/exit 1/)
	})
})
