/// <reference types="bun-types" />

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { injectGitMasterConfig } from "./git-master-template-injection"

const TEMPLATE = "# Git\n\nBody.\n"
const PREFIX_ONLY = { commit_footer: false, include_co_authored_by: false, git_env_prefix: "GIT_MASTER=1" }

describe("#given shell detection in injectGitMasterConfig", () => {
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
    it("#then the line form uses $env: syntax and the Bun.$ env form is unchanged", () => {
      delete process.env.SHELL
      delete process.env.MSYSTEM
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "win32" })

      const result = injectGitMasterConfig(TEMPLATE, PREFIX_ONLY)

      expect(result).toContain("$env:GIT_MASTER='1'; git")
      expect(result).toContain('GIT_MASTER: "1"')
    })
  })

  describe("#when shell is Git Bash on Windows (SHELL env set)", () => {
    it("#then the line form stays unix-style", () => {
      process.env.SHELL = "C:\\Program Files\\Git\\bin\\bash.exe"
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "win32" })

      const result = injectGitMasterConfig(TEMPLATE, PREFIX_ONLY)

      expect(result).toContain("GIT_MASTER=1 git")
      expect(result).not.toContain("$env:")
    })
  })

  for (const shellPath of ["/bin/csh", "/usr/local/bin/tcsh"]) {
    describe(`#when shell is ${shellPath}`, () => {
      it("#then the line form uses setenv syntax", () => {
        process.env.SHELL = shellPath
        delete process.env.PSModulePath
        delete process.env.MSYSTEM
        Object.defineProperty(process, "platform", { value: "linux" })

        const result = injectGitMasterConfig(TEMPLATE, PREFIX_ONLY)

        expect(result).toContain("setenv GIT_MASTER 1; git")
      })
    })
  }
})
