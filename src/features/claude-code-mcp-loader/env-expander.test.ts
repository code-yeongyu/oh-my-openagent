import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as shared from "../../shared/logger"
import {
  resetAdditionalAllowedMcpEnvVars,
  setAdditionalAllowedMcpEnvVars,
} from "./configure-allowed-env-vars"
import { expandEnvVars, expandEnvVarsInObject } from "./env-expander"

describe("expandEnvVars", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value
    }

    mock.restore()
    resetAdditionalAllowedMcpEnvVars()
  })

  describe("#given a sensitive environment variable reference", () => {
    it("#when expanding the value #then it returns an empty string and logs a warning", () => {
      // given
      process.env.GITHUB_TOKEN = "ghp-secret"
      const logSpy = spyOn(shared, "log").mockImplementation(() => {})

      // when
      const expanded = expandEnvVars("${GITHUB_TOKEN}")

      // then
      expect(expanded).toBe("")
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Blocked MCP env var expansion"),
        expect.objectContaining({ varName: "GITHUB_TOKEN" })
      )
    })
  })

  describe("#given a benign environment variable in the builtin allowlist", () => {
    it("#when expanding the value #then it returns the env value", () => {
      // given
      process.env.TMPDIR = "/tmp/omo"
      process.env.LANG = "en_US.UTF-8"
      process.env.XDG_CONFIG_HOME = "/Users/tester/.config"

      // when
      const expanded = expandEnvVars(
        "${TMPDIR}|${LANG}|${XDG_CONFIG_HOME}"
      )

      // then
      expect(expanded).toBe("/tmp/omo|en_US.UTF-8|/Users/tester/.config")
    })
  })

  describe("#given a blocked non-sensitive environment variable reference", () => {
    it("#when expanding the value #then it returns an empty string and logs a warning", () => {
      // given
      process.env.PROJECT_ROOT = "/Users/tester/project"
      const logSpy = spyOn(shared, "log").mockImplementation(() => {})

      // when
      const expanded = expandEnvVars("${PROJECT_ROOT}")

      // then
      expect(expanded).toBe("")
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Blocked MCP env var expansion"),
        expect.objectContaining({ varName: "PROJECT_ROOT" })
      )
    })
  })

  describe("#given a blocked variable with a default value", () => {
    it("#when expanding the value #then it uses the default instead of the sensitive env var", () => {
      // given
      process.env.SECRET_KEY = "super-secret"

      // when
      const expanded = expandEnvVars("${SECRET_KEY:-fallback}")

      // then
      expect(expanded).toBe("fallback")
    })
  })

  describe("#given a safe allowlisted environment variable reference", () => {
    it("#when expanding the value #then it returns the env value", () => {
      // given
      process.env.HOME = "/Users/tester"

      // when
      const expanded = expandEnvVars("${HOME}")

      // then
      expect(expanded).toBe("/Users/tester")
    })
  })

  describe("#given a sensitive environment variable listed in the user allowlist", () => {
    it("#when expanding the value #then it returns the env value", () => {
      // given
      process.env.CUSTOM_API_KEY = "user-approved"
      setAdditionalAllowedMcpEnvVars(["CUSTOM_API_KEY"])

      // when
      const expanded = expandEnvVars("${CUSTOM_API_KEY}")

      // then
      expect(expanded).toBe("user-approved")
    })
  })
})

describe("expandEnvVarsInObject", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value
    }

    mock.restore()
    resetAdditionalAllowedMcpEnvVars()
  })

  describe("#given a nested MCP config object", () => {
    it("#when expanding env vars in the object #then it only expands safe values", () => {
      // given
      process.env.HOME = "/Users/tester"
      process.env.AWS_SECRET_ACCESS_KEY = "aws-secret"

      // when
      const expanded = expandEnvVarsInObject({
        url: "https://example.com/${AWS_SECRET_ACCESS_KEY}",
        args: ["--dir", "${HOME}"],
        headers: {
          Authorization: "Bearer ${AWS_SECRET_ACCESS_KEY}",
        },
      })

      // then
      expect(expanded).toEqual({
        url: "https://example.com/",
        args: ["--dir", "/Users/tester"],
        headers: {
          Authorization: "Bearer ",
        },
      })
    })
  })
})
