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

	describe("#when shell type is csh", () => {
		it("#then returns csh setenv syntax", () => {
			const result = buildShellAwareGitPrefix("GIT_MASTER=1", "csh")
			expect(result).toBe("setenv GIT_MASTER 1;")
		})

		it("#then handles multiple env vars", () => {
			const result = buildShellAwareGitPrefix("CI=true GIT_MASTER=1", "csh")
			expect(result).toBe("setenv CI true; setenv GIT_MASTER 1;")
		})
	})

	describe("#when prefix is empty", () => {
		it("#then returns empty string", () => {
			const result = buildShellAwareGitPrefix("", "powershell")
			expect(result).toBe("")
		})
	})
})
