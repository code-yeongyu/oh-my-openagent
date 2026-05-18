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

	describe("#when git_env_prefix contains shell metacharacters", () => {
		it("#then rejects the malicious value", () => {
			expect(() =>
				injectGitMasterConfig(SAMPLE_TEMPLATE, {
					commit_footer: false,
					include_co_authored_by: false,
					git_env_prefix: "A=1; rm -rf /",
				})
			).toThrow('git_env_prefix must be empty or use shell-safe env assignments like "GIT_MASTER=1"')
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

	describe("#when the template already contains bare git commands in bash blocks", () => {
		it("#then prefixes every git invocation in the final output", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

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

describe("#given idempotency of prefixGitCommandsInBashCodeBlocks", () => {
	describe("#when git_env_prefix is provided and template already has prefixed commands in env prefix section", () => {
		it("#then does NOT double-prefix the already-prefixed commands", () => {
			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

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

describe("#given parseBashEnvPrefix", () => {
	describe("#when single VAR=value pair", () => {
		it("#then parses into a single-entry record", () => {
			const result = parseBashEnvPrefix("GIT_MASTER=1")
			expect(result).toEqual({ GIT_MASTER: "1" })
		})
	})

	describe("#when multiple VAR=value pairs", () => {
		it("#then parses all pairs", () => {
			const result = parseBashEnvPrefix("CI=true DEBIAN_FRONTEND=noninteractive")
			expect(result).toEqual({ CI: "true", DEBIAN_FRONTEND: "noninteractive" })
		})
	})

	describe("#when empty string", () => {
		it("#then returns empty record", () => {
			const result = parseBashEnvPrefix("")
			expect(result).toEqual({})
		})
	})
})

describe("#given buildShellAwareGitPrefix", () => {
	describe("#when shell type is unix", () => {
		it("#then returns the bash prefix unchanged", () => {
			const result = buildShellAwareGitPrefix("GIT_MASTER=1", "unix")
			expect(result).toBe("GIT_MASTER=1")
		})
	})

	describe("#when shell type is powershell", () => {
		it("#then returns PowerShell $env: syntax", () => {
			const result = buildShellAwareGitPrefix("GIT_MASTER=1", "powershell")
			expect(result).toBe("$env:GIT_MASTER='1';")
		})

		it("#then handles multiple env vars", () => {
			const result = buildShellAwareGitPrefix("CI=true GIT_MASTER=1", "powershell")
			expect(result).toBe("$env:CI='true'; $env:GIT_MASTER='1';")
		})
	})

	describe("#when shell type is cmd", () => {
		it("#then returns cmd set syntax", () => {
			const result = buildShellAwareGitPrefix("GIT_MASTER=1", "cmd")
			expect(result).toBe('set GIT_MASTER="1" &&')
		})

		it("#then handles multiple env vars", () => {
			const result = buildShellAwareGitPrefix("CI=true GIT_MASTER=1", "cmd")
			expect(result).toBe('set CI="true" && set GIT_MASTER="1" &&')
		})
	})

	describe("#when prefix is empty", () => {
		it("#then returns empty string", () => {
			const result = buildShellAwareGitPrefix("", "powershell")
			expect(result).toBe("")
		})
	})
})

describe("#given PowerShell shell detection in injectGitMasterConfig", () => {
	let originalEnv: Record<string, string | undefined>
	let originalPlatform: NodeJS.Platform

	beforeEach(() => {
		originalPlatform = process.platform
		originalEnv = {
			SHELL: process.env.SHELL,
			PSModulePath: process.env.PSModulePath,
			MSYSTEM: process.env.MSYSTEM,
		}
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value !== undefined) {
				process.env[key] = value
			} else {
				delete process.env[key]
			}
		}
	})

	describe("#when shell is PowerShell (PSModulePath set, no SHELL)", () => {
		it("#then emits $env: prefix syntax in pwsh code block", () => {
			delete process.env.SHELL
			delete process.env.MSYSTEM
			process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
			Object.defineProperty(process, "platform", { value: "win32" })

			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("$env:GIT_MASTER='1'; git status")
			expect(result).toContain("```pwsh")
			expect(result).not.toContain("```bash\n$env:")
		})

		it("#then does NOT prefix bash code blocks with PowerShell syntax", () => {
			delete process.env.SHELL
			delete process.env.MSYSTEM
			process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
			Object.defineProperty(process, "platform", { value: "win32" })

			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			const bashBlockMatch = result.match(/```bash\r?\n([\s\S]*?)```/g)
			if (bashBlockMatch) {
				for (const block of bashBlockMatch) {
					expect(block).not.toContain("$env:")
				}
			}
		})
	})

	describe("#when shell is Git Bash on Windows (SHELL env set)", () => {
		it("#then keeps unix-style prefix", () => {
			process.env.SHELL = "C:\\Program Files\\Git\\bin\\bash.exe"
			process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
			Object.defineProperty(process, "platform", { value: "win32" })

			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("GIT_MASTER=1 git status")
			expect(result).toContain("```bash")
			expect(result).not.toContain("$env:")
		})
	})
})
