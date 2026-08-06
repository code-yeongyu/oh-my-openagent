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

	describe("#when shell is csh (SHELL set to /bin/csh)", () => {
		it("#then emits setenv prefix syntax in csh code block", () => {
			process.env.SHELL = "/bin/csh"
			delete process.env.PSModulePath
			delete process.env.MSYSTEM
			Object.defineProperty(process, "platform", { value: "linux" })

			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("setenv GIT_MASTER 1;")
			expect(result).toContain("```csh")
			expect(result).not.toContain("```bash\nsetenv")
		})

		it("#then does NOT prefix bash code blocks with setenv syntax", () => {
			process.env.SHELL = "/bin/csh"
			delete process.env.PSModulePath
			delete process.env.MSYSTEM
			Object.defineProperty(process, "platform", { value: "linux" })

			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			const bashBlockMatch = result.match(/```bash\r?\n([\s\S]*?)```/g)
			if (bashBlockMatch) {
				for (const block of bashBlockMatch) {
					expect(block).not.toContain("setenv")
				}
			}
		})
	})

	describe("#when shell is tcsh (SHELL set to /usr/local/bin/tcsh)", () => {
		it("#then emits setenv prefix syntax in csh code block", () => {
			process.env.SHELL = "/usr/local/bin/tcsh"
			delete process.env.PSModulePath
			delete process.env.MSYSTEM
			Object.defineProperty(process, "platform", { value: "darwin" })

			const result = injectGitMasterConfig(SAMPLE_TEMPLATE, {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			})

			expect(result).toContain("setenv GIT_MASTER 1;")
			expect(result).toContain("```csh")
		})
	})
})
