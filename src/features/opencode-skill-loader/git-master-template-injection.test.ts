/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { injectGitMasterConfig } from "./git-master-template-injection"

const SAMPLE_TEMPLATE = [
	"# Git Master Agent",
	"",
	"## MODE DETECTION (FIRST STEP)",
	"",
	"Analyze the request.",
	"",
	"```bash",
	"git status",
	"```",
	"",
	"```",
	"</execution>",
].join("\n")

describe("#given git_env_prefix config", () => {
	describe("#when default config (GIT_MASTER=1)", () => {
		it("#then injects env prefix section before MODE DETECTION", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("## GIT COMMAND PREFIX (MANDATORY)")
			expect(result).toContain("GIT_MASTER=1 git status")
			expect(result).toContain("GIT_MASTER=1 git commit")
			expect(result).toContain("GIT_MASTER=1 git push")
			expect(result).toContain("EVERY git command MUST be prefixed with `GIT_MASTER=1`")

			const prefixIndex = result.indexOf("## GIT COMMAND PREFIX")
			const modeIndex = result.indexOf("## MODE DETECTION")
			expect(prefixIndex).toBeLessThan(modeIndex)
		})
	})

	describe("#when git_env_prefix is empty string", () => {
		it("#then does NOT inject env prefix section", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "",
			})

			expect(result).not.toContain("## GIT COMMAND PREFIX")
			expect(result).not.toContain("GIT_MASTER=1")
			expect(result).not.toContain("git_env_prefix")
		})
	})

	describe("#when git_env_prefix is custom value", () => {
		it("#then injects custom prefix in section", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "MY_HOOK=active",
			})

			expect(result).toContain("MY_HOOK=active git status")
			expect(result).toContain("MY_HOOK=active git commit")
			expect(result).not.toContain("GIT_MASTER=1")
		})
	})

	describe("#when no config provided", () => {
		it("#then uses default GIT_MASTER=1 prefix", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE)

			expect(result).toContain("GIT_MASTER=1 git status")
			expect(result).toContain("## GIT COMMAND PREFIX (MANDATORY)")
		})
	})
})

describe("#given git_env_prefix with commit footer", () => {
	describe("#when both env prefix and footer are enabled", () => {
		it("#then commit examples include the env prefix", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: true,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("GIT_MASTER=1 git commit")
			expect(result).toContain("Ultraworked with [Sisyphus]")
		})
	})

	describe("#when env prefix disabled but footer enabled", () => {
		it("#then commit examples have no env prefix", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: true,
				include_co_authored_by: false,
				git_env_prefix: "",
			})

			expect(result).not.toContain("GIT_MASTER=1 git commit")
			expect(result).toContain("git commit -m")
			expect(result).toContain("Ultraworked with [Sisyphus]")
		})
	})

	describe("#when both env prefix and co-author are enabled", () => {
		it("#then commit example includes prefix, footer, and co-author", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: true,
				include_co_authored_by: true,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("GIT_MASTER=1 git commit")
			expect(result).toContain("Ultraworked with [Sisyphus]")
			expect(result).toContain("Co-authored-by: Sisyphus")
		})
	})
})
