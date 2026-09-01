/// <reference types="bun-types" />

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { injectGitMasterConfig, parseBashEnvPrefix, buildShellAwareGitPrefix } from "./git-master-template-injection"

const SAMPLE_TEMPLATE = [
	"# Git Master Agent",
	"",
	"## MODE DETECTION (FIRST STEP)",
	"",
	"Analyze the request.",
	"",
	"```bash",
	"git status",
	"git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null",
	"MERGE_BASE=$(git merge-base HEAD main)",
	"GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash $MERGE_BASE",
	"```",
	"",
	"```",
	"</execution>",
].join("\n")

/** Dynamic fixture: a footer value no shipped default contains. */
const FOOTER_FIXTURE = "FOOTER_PROPAGATION_SENTINEL_9d41"

/**
 * Source parser for the rendered skill: every `git commit -m` line inside
 * bash code blocks, in render order. Observes what the injected commit
 * example actually ships instead of diffing two production outputs.
 */
function bashCommitExampleLines(rendered: string): string[] {
	const bashBlocks = [...rendered.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map(
		(match) => match[1],
	)
	return bashBlocks.flatMap((block) =>
		block
			.split("\n")
			.filter((line) => line.includes("git commit -m")),
	)
}

function restoreEnv(env: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) {
			process.env[key] = value
		} else {
			delete process.env[key]
		}
	}
}

function withUnixShell<T>(callback: () => T): T {
	const originalPlatform = process.platform
	const originalEnv = {
		SHELL: process.env.SHELL,
		PSModulePath: process.env.PSModulePath,
		MSYSTEM: process.env.MSYSTEM,
	}

	Object.defineProperty(process, "platform", { value: "linux" })
	process.env.SHELL = "/bin/bash"
	delete process.env.PSModulePath
	delete process.env.MSYSTEM

	try {
		return callback()
	} finally {
		Object.defineProperty(process, "platform", { value: originalPlatform })
		restoreEnv(originalEnv)
	}
}

describe("#given git_env_prefix config", () => {
	describe("#when default config (GIT_MASTER=1)", () => {
		it("#then injects env prefix section before MODE DETECTION", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			}))

			expect(result).toContain("GIT_MASTER=1 git status")
			expect(result).toContain("GIT_MASTER=1 git commit")
			expect(result).toContain("GIT_MASTER=1 git push")

			const prefixIndex = result.indexOf("GIT_MASTER=1 git status")
			const modeIndex = result.indexOf("## MODE DETECTION")
			expect(prefixIndex).toBeLessThan(modeIndex)
		})
	})

	describe("#when git_env_prefix is empty string", () => {
		it("#then does NOT inject env prefix section", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "",
			}))

			expect(result).not.toContain("GIT_MASTER=1")
			expect(result).not.toContain("git_env_prefix")
		})
	})

	describe("#when git_env_prefix is custom value", () => {
		it("#then injects custom prefix in section", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "MY_HOOK=active",
			}))

			expect(result).toContain("MY_HOOK=active git status")
			expect(result).toContain("MY_HOOK=active git commit")
			expect(result).not.toContain("GIT_MASTER=1")
		})
	})

	describe("#when git_env_prefix contains shell metacharacters", () => {
		it("#then rejects the malicious value", () => {
			expect(() =>
				withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
					commit_footer: false,
					include_co_authored_by: false,
					git_env_prefix: "A=1; rm -rf /",
				}))
			).toThrow('git_env_prefix must be empty or use shell-safe env assignments like "GIT_MASTER=1"')
		})
	})

	describe("#when no config provided", () => {
		it("#then uses default GIT_MASTER=1 prefix", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE))

			expect(result).toContain("GIT_MASTER=1 git status")
		})
	})
})

describe("#given git_env_prefix with commit footer", () => {
	describe("#when both env prefix and a dynamic footer fixture are enabled", () => {
		it("#then the injected commit example carries the fixture under the env prefix", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: FOOTER_FIXTURE,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			}))

			const examples = bashCommitExampleLines(result)
			const injected = examples.filter((line) => line.includes(FOOTER_FIXTURE))

			// the dynamic footer fixture propagated into a real commit example
			expect(injected.length).toBeGreaterThan(0)
			// every fixture-bearing example is env-prefixed
			expect(injected.every((line) => line.startsWith("GIT_MASTER=1 git commit"))).toBe(true)
			// co-author branch is off in this configuration
			expect(examples.some((line) => line.includes("Co-authored-by:"))).toBe(false)
		})
	})

	describe("#when the template already contains bare git commands in bash blocks", () => {
		it("#then prefixes every git invocation in the final output", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			}))

			expect(result).toContain("GIT_MASTER=1 git status")
			expect(result).toContain(
				"GIT_MASTER=1 git merge-base HEAD main 2>/dev/null || GIT_MASTER=1 git merge-base HEAD master 2>/dev/null"
			)
			expect(result).toContain("MERGE_BASE=$(GIT_MASTER=1 git merge-base HEAD main)")
			expect(result).toContain(
				"GIT_SEQUENCE_EDITOR=: GIT_MASTER=1 git rebase -i --autosquash $MERGE_BASE"
			)
		})
	})

	describe("#when env prefix disabled but footer enabled", () => {
		it("#then the injected commit example stays unprefixed but carries the fixture", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: FOOTER_FIXTURE,
				include_co_authored_by: false,
				git_env_prefix: "",
			}))

			const examples = bashCommitExampleLines(result)
			const injected = examples.filter((line) => line.includes(FOOTER_FIXTURE))

			// the footer fixture still reaches a commit example without a prefix
			expect(injected.length).toBeGreaterThan(0)
			expect(injected.every((line) => !line.includes("GIT_MASTER=1"))).toBe(true)
		})
	})

	describe("#when both env prefix and co-author are enabled", () => {
		it("#then the injected commit example carries fixture and co-author trailer together", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: FOOTER_FIXTURE,
				include_co_authored_by: true,
				git_env_prefix: "GIT_MASTER=1",
			}))

			const examples = bashCommitExampleLines(result)
			const injected = examples.filter((line) => line.includes(FOOTER_FIXTURE))

			// one example carries both the dynamic fixture and the git trailer
			expect(
				injected.some(
					(line) => line.includes("Co-authored-by: ") && line.startsWith("GIT_MASTER=1 git commit"),
			),
			).toBe(true)
		})
	})
})

describe("#given idempotency of prefixGitCommandsInBashCodeBlocks", () => {
	describe("#when git_env_prefix is provided and template already has prefixed commands in env prefix section", () => {
		it("#then does NOT double-prefix the already-prefixed commands", () => {
			const result = withUnixShell(() => injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			}))

			expect(result).not.toContain("GIT_MASTER=1 GIT_MASTER=1 git status")
			expect(result).not.toContain("GIT_MASTER=1 GIT_MASTER=1 git add")
			expect(result).not.toContain("GIT_MASTER=1 GIT_MASTER=1 git commit")
			expect(result).not.toContain("GIT_MASTER=1 GIT_MASTER=1 git push")

			expect(result).toContain("GIT_MASTER=1 git status")
			expect(result).toContain("GIT_MASTER=1 git add")
			expect(result).toContain("GIT_MASTER=1 git commit")
			expect(result).toContain("GIT_MASTER=1 git push")
		})
	})
})
