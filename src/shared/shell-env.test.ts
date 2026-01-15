import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { detectShellType, shellEscape, buildEnvPrefix } from "./shell-env"

describe("shell-env", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      SHELL: process.env.SHELL,
      PSModulePath: process.env.PSModulePath,
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

  describe("detectShellType", () => {
    test("#given SHELL env var set to /bin/bash #when detectShellType is called #then returns unix", () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/bash"
      Object.defineProperty(process, "platform", { value: "linux" })

      const result = detectShellType()

      expect(result).toBe("unix")
    })

    test("#given SHELL env var set to /bin/zsh #when detectShellType is called #then returns unix", () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/zsh"
      Object.defineProperty(process, "platform", { value: "darwin" })

      const result = detectShellType()

      expect(result).toBe("unix")
    })

    test("#given PSModulePath is set #when detectShellType is called #then returns powershell", () => {
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "win32" })

      const result = detectShellType()

      expect(result).toBe("powershell")
    })

    test("#given Windows platform without PSModulePath #when detectShellType is called #then returns cmd", () => {
      delete process.env.PSModulePath
      delete process.env.SHELL
      Object.defineProperty(process, "platform", { value: "win32" })

      const result = detectShellType()

      expect(result).toBe("cmd")
    })

    test("#given non-Windows platform without SHELL env var #when detectShellType is called #then returns unix", () => {
      delete process.env.PSModulePath
      delete process.env.SHELL
      Object.defineProperty(process, "platform", { value: "linux" })

      const result = detectShellType()

      expect(result).toBe("unix")
    })

    test("#given PSModulePath takes priority over SHELL #when both are set #then returns powershell", () => {
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      process.env.SHELL = "/bin/bash"
      Object.defineProperty(process, "platform", { value: "win32" })

      const result = detectShellType()

      expect(result).toBe("powershell")
    })
  })

  describe("shellEscape", () => {
    describe("unix shell", () => {
      test("#given plain alphanumeric string #when shellEscape is called with unix #then returns unquoted string", () => {
        const result = shellEscape("simple123", "unix")
        expect(result).toBe("simple123")
      })

      test("#given empty string #when shellEscape is called with unix #then returns single quotes", () => {
        const result = shellEscape("", "unix")
        expect(result).toBe("''")
      })

      test("#given string with spaces #when shellEscape is called with unix #then wraps in single quotes", () => {
        const result = shellEscape("has spaces", "unix")
        expect(result).toBe("'has spaces'")
      })

      test("#given string with single quote #when shellEscape is called with unix #then escapes with backslash", () => {
        const result = shellEscape("it's", "unix")
        expect(result).toBe("'it'\\''s'")
      })

      test("#given string with colon and slash #when shellEscape is called with unix #then returns unquoted", () => {
        const result = shellEscape("/usr/bin:/bin", "unix")
        expect(result).toBe("/usr/bin:/bin")
      })

      test("#given string with newline #when shellEscape is called with unix #then preserves newline in quotes", () => {
        const result = shellEscape("line1\nline2", "unix")
        expect(result).toBe("'line1\nline2'")
      })
    })

    describe("powershell", () => {
      test("#given plain alphanumeric string #when shellEscape is called with powershell #then wraps in single quotes", () => {
        const result = shellEscape("simple123", "powershell")
        expect(result).toBe("'simple123'")
      })

      test("#given empty string #when shellEscape is called with powershell #then returns single quotes", () => {
        const result = shellEscape("", "powershell")
        expect(result).toBe("''")
      })

      test("#given string with spaces #when shellEscape is called with powershell #then wraps in single quotes", () => {
        const result = shellEscape("has spaces", "powershell")
        expect(result).toBe("'has spaces'")
      })

      test("#given string with single quote #when shellEscape is called with powershell #then escapes with double quote", () => {
        const result = shellEscape("it's", "powershell")
        expect(result).toBe("'it''s'")
      })

      test("#given string with dollar sign #when shellEscape is called with powershell #then wraps to prevent expansion", () => {
        const result = shellEscape("$var", "powershell")
        expect(result).toBe("'$var'")
      })

      test("#given Windows path with backslashes #when shellEscape is called with powershell #then preserves backslashes", () => {
        const result = shellEscape("C:\\path", "powershell")
        expect(result).toBe("'C:\\path'")
      })

      test("#given string with colon #when shellEscape is called with powershell #then wraps in quotes", () => {
        const result = shellEscape("key:value", "powershell")
        expect(result).toBe("'key:value'")
      })
    })

    describe("cmd.exe", () => {
      test("#given plain alphanumeric string #when shellEscape is called with cmd #then wraps in double quotes", () => {
        const result = shellEscape("simple123", "cmd")
        expect(result).toBe('"simple123"')
      })

      test("#given empty string #when shellEscape is called with cmd #then returns double quotes", () => {
        const result = shellEscape("", "cmd")
        expect(result).toBe('""')
      })

      test("#given string with spaces #when shellEscape is called with cmd #then wraps in double quotes", () => {
        const result = shellEscape("has spaces", "cmd")
        expect(result).toBe('"has spaces"')
      })

      test("#given string with double quote #when shellEscape is called with cmd #then escapes with double quote", () => {
        const result = shellEscape('say "hello"', "cmd")
        expect(result).toBe('"say ""hello"""')
      })

      test("#given string with percent signs #when shellEscape is called with cmd #then escapes percent signs", () => {
        const result = shellEscape("%PATH%", "cmd")
        expect(result).toBe('"%%PATH%%"')
      })

      test("#given Windows path with backslashes #when shellEscape is called with cmd #then preserves backslashes", () => {
        const result = shellEscape("C:\\path", "cmd")
        expect(result).toBe('"C:\\path"')
      })

      test("#given string with colon #when shellEscape is called with cmd #then wraps in double quotes", () => {
        const result = shellEscape("key:value", "cmd")
        expect(result).toBe('"key:value"')
      })
    })
  })

  describe("buildEnvPrefix", () => {
    describe("unix shell", () => {
      test("#given single environment variable #when buildEnvPrefix is called with unix #then builds export statement", () => {
        const result = buildEnvPrefix({ VAR: "value" }, "unix")
        expect(result).toBe("export VAR=value;")
      })

      test("#given multiple environment variables #when buildEnvPrefix is called with unix #then builds export statement with all vars", () => {
        const result = buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "unix")
        expect(result).toBe("export VAR1=val1 VAR2=val2;")
      })

      test("#given env var with special chars #when buildEnvPrefix is called with unix #then escapes value", () => {
        const result = buildEnvPrefix({ PATH: "/usr/bin:/bin" }, "unix")
        expect(result).toBe("export PATH=/usr/bin:/bin;")
      })

      test("#given env var with spaces #when buildEnvPrefix is called with unix #then escapes with quotes", () => {
        const result = buildEnvPrefix({ MSG: "has spaces" }, "unix")
        expect(result).toBe("export MSG='has spaces';")
      })

      test("#given empty env object #when buildEnvPrefix is called with unix #then returns empty string", () => {
        const result = buildEnvPrefix({}, "unix")
        expect(result).toBe("")
      })
    })

    describe("powershell", () => {
      test("#given single environment variable #when buildEnvPrefix is called with powershell #then builds $env assignment", () => {
        const result = buildEnvPrefix({ VAR: "value" }, "powershell")
        expect(result).toBe("$env:VAR='value';")
      })

      test("#given multiple environment variables #when buildEnvPrefix is called with powershell #then builds multiple assignments", () => {
        const result = buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "powershell")
        expect(result).toBe("$env:VAR1='val1'; $env:VAR2='val2';")
      })

      test("#given env var with special chars #when buildEnvPrefix is called with powershell #then escapes value", () => {
        const result = buildEnvPrefix({ MSG: "it's working" }, "powershell")
        expect(result).toBe("$env:MSG='it''s working';")
      })

      test("#given env var with dollar sign #when buildEnvPrefix is called with powershell #then escapes to prevent expansion", () => {
        const result = buildEnvPrefix({ VAR: "$test" }, "powershell")
        expect(result).toBe("$env:VAR='$test';")
      })

      test("#given empty env object #when buildEnvPrefix is called with powershell #then returns empty string", () => {
        const result = buildEnvPrefix({}, "powershell")
        expect(result).toBe("")
      })
    })

    describe("cmd.exe", () => {
      test("#given single environment variable #when buildEnvPrefix is called with cmd #then builds set command", () => {
        const result = buildEnvPrefix({ VAR: "value" }, "cmd")
        expect(result).toBe('set VAR="value" &&')
      })

      test("#given multiple environment variables #when buildEnvPrefix is called with cmd #then builds multiple set commands", () => {
        const result = buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "cmd")
        expect(result).toBe('set VAR1="val1" && set VAR2="val2" &&')
      })

      test("#given env var with special chars #when buildEnvPrefix is called with cmd #then escapes value", () => {
        const result = buildEnvPrefix({ MSG: "has spaces" }, "cmd")
        expect(result).toBe('set MSG="has spaces" &&')
      })

      test("#given env var with double quotes #when buildEnvPrefix is called with cmd #then escapes quotes", () => {
        const result = buildEnvPrefix({ MSG: 'say "hello"' }, "cmd")
        expect(result).toBe('set MSG="say ""hello""" &&')
      })

      test("#given empty env object #when buildEnvPrefix is called with cmd #then returns empty string", () => {
        const result = buildEnvPrefix({}, "cmd")
        expect(result).toBe("")
      })
    })
  })
})
