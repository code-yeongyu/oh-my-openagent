/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { buildShellAwareGitPrefix, injectGitMasterConfig, parseBashEnvPrefix } from "./git-master-template-injection"

const TEMPLATE_COMMANDS = [
  "git status",
  "git merge-base HEAD main",
  "git commit -m sentinel",
] as const
const SAMPLE_TEMPLATE = `# SENTINEL_TEMPLATE\n\n## SENTINEL_INSERTION_POINT\n\n\`\`\`bash\n${TEMPLATE_COMMANDS.join("\n")}\n\`\`\``

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value
    else delete process.env[key]
  }
}

function withShell<T>(platform: NodeJS.Platform, shell: string | undefined, callback: () => T): T {
  const originalPlatform = process.platform
  const originalEnv = { SHELL: process.env.SHELL, PSModulePath: process.env.PSModulePath, MSYSTEM: process.env.MSYSTEM }
  Object.defineProperty(process, "platform", { value: platform })
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  delete process.env.MSYSTEM
  try { return callback() } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    restoreEnv(originalEnv)
  }
}

function expectCommandsPrefixed(result: string, prefix: string): void {
  for (const command of TEMPLATE_COMMANDS) {
    expect(result).toContain(`${prefix} ${command}`)
  }
}

describe("injectGitMasterConfig", () => {
  it("propagates the configured Unix env prefix to template commands", () => {
    const gitEnvPrefix = "SENTINEL_GIT_ENV=enabled"
    const result = withShell("linux", "/bin/bash", () => injectGitMasterConfig(SAMPLE_TEMPLATE, {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: gitEnvPrefix,
    }))

    expectCommandsPrefixed(result, buildShellAwareGitPrefix(gitEnvPrefix, "unix"))
  })

  it("leaves template commands unchanged when the prefix is disabled", () => {
    const result = withShell("linux", "/bin/bash", () => injectGitMasterConfig(SAMPLE_TEMPLATE, {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    }))

    for (const command of TEMPLATE_COMMANDS) expect(result).toContain(command)
  })

  it("rejects shell metacharacters in the configured prefix", () => {
    expect(() => withShell("linux", "/bin/bash", () => injectGitMasterConfig(SAMPLE_TEMPLATE, {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "A=1; rm -rf /",
    }))).toThrow()
  })

  it("uses PowerShell routing when PowerShell is detected", () => {
    const gitEnvPrefix = "SENTINEL_GIT_ENV=enabled"
    const result = withShell("win32", undefined, () => {
      process.env.PSModulePath = "C:\\PowerShell\\Modules"
      return injectGitMasterConfig(SAMPLE_TEMPLATE, {
        commit_footer: false,
        include_co_authored_by: false,
        git_env_prefix: gitEnvPrefix,
      })
    })

    expect(result).toContain(buildShellAwareGitPrefix(gitEnvPrefix, "powershell"))
    for (const command of TEMPLATE_COMMANDS) expect(result).toContain(command)
  })

  it("uses csh routing when csh is detected", () => {
    const gitEnvPrefix = "SENTINEL_GIT_ENV=enabled"
    const result = withShell("linux", "/bin/csh", () => injectGitMasterConfig(SAMPLE_TEMPLATE, {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: gitEnvPrefix,
    }))

    expect(result).toContain(buildShellAwareGitPrefix(gitEnvPrefix, "csh"))
    for (const command of TEMPLATE_COMMANDS) expect(result).toContain(command)
  })
})

describe("parseBashEnvPrefix", () => {
  it("parses one assignment", () => {
    expect(parseBashEnvPrefix("GIT_MASTER=1")).toEqual({ GIT_MASTER: "1" })
  })

  it("parses multiple assignments", () => {
    expect(parseBashEnvPrefix("CI=true DEBIAN_FRONTEND=noninteractive")).toEqual({ CI: "true", DEBIAN_FRONTEND: "noninteractive" })
  })

  it("parses an empty prefix", () => {
    expect(parseBashEnvPrefix("")).toEqual({})
  })
})

describe("buildShellAwareGitPrefix", () => {
  const cases = [
    ["unix", "GIT_MASTER=1"],
    ["powershell", "$env:GIT_MASTER='1';"],
    ["cmd", 'set GIT_MASTER="1" &&'],
    ["csh", "setenv GIT_MASTER 1;"],
  ] as const

  for (const [shell, expected] of cases) {
    it(`renders ${shell} syntax`, () => {
      expect(buildShellAwareGitPrefix("GIT_MASTER=1", shell)).toBe(expected)
    })
  }

  it("renders multiple assignments", () => {
    expect(buildShellAwareGitPrefix("CI=true GIT_MASTER=1", "powershell")).toBe("$env:CI='true'; $env:GIT_MASTER='1';")
  })

  it("preserves an empty prefix", () => {
    expect(buildShellAwareGitPrefix("", "powershell")).toBe("")
  })
})
