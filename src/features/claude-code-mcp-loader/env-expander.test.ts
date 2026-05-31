import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as shared from "../../shared/logger"
import {
  resetAdditionalAllowedMcpEnvVars,
  setAdditionalAllowedMcpEnvVars,
} from "./configure-allowed-env-vars"

type EnvExpanderModule = typeof import("./env-expander")

async function importFreshEnvExpanderModule(): Promise<EnvExpanderModule> {
  return await import(`./env-expander?test=${Date.now()}-${Math.random()}`)
}

function hasBlockedExpansionLog(logSpy: ReturnType<typeof spyOn>, varName: string): boolean {
  return logSpy.mock.calls.some(([message, data]) => {
    if (typeof message !== "string") {
      return false
    }

    if (!message.includes("Blocked MCP env var expansion")) {
      return false
    }

    if (typeof data !== "object" || data === null) {
      return false
    }

    return "varName" in data && data.varName === varName
  })
}

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
    it("#when expanding the value #then it returns an empty string and logs a warning", async () => {
      // given
      process.env.GITHUB_TOKEN = "ghp-secret"
      const logSpy = spyOn(shared, "log").mockImplementation(() => {})
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${GITHUB_TOKEN}")

      // then
      expect(expanded).toBe("")
      expect(hasBlockedExpansionLog(logSpy, "GITHUB_TOKEN")).toBe(true)
    })
  })

  describe("#given a benign environment variable in the builtin allowlist", () => {
    it("#when expanding the value #then it returns the env value", async () => {
      // given
      process.env.TMPDIR = "/tmp/omo"
      process.env.TEMP = "C:\\Temp"
      process.env.USERPROFILE = "C:\\Users\\tester"
      process.env.LANG = "en_US.UTF-8"
      process.env.XDG_CONFIG_HOME = "/Users/tester/.config"
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars(
        "${TMPDIR}|${TEMP}|${USERPROFILE}|${LANG}|${XDG_CONFIG_HOME}"
      )

      // then
      expect(expanded).toBe(
        "/tmp/omo|C:\\Temp|C:\\Users\\tester|en_US.UTF-8|/Users/tester/.config"
      )
    })
  })

  describe("#given a blocked non-sensitive environment variable reference", () => {
    it("#when expanding the value #then it returns an empty string and logs a warning", async () => {
      // given
      process.env.PROJECT_ROOT = "/Users/tester/project"
      const logSpy = spyOn(shared, "log").mockImplementation(() => {})
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${PROJECT_ROOT}")

      // then
      expect(expanded).toBe("")
      expect(hasBlockedExpansionLog(logSpy, "PROJECT_ROOT")).toBe(true)
    })
  })

  describe("#given a blocked variable with a default value", () => {
    it("#when expanding the value #then it uses the default instead of the sensitive env var", async () => {
      // given
      process.env.SECRET_KEY = "super-secret"
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${SECRET_KEY:-fallback}")

      // then
      expect(expanded).toBe("fallback")
    })
  })

  describe("#given a safe allowlisted environment variable reference", () => {
    it("#when expanding the value #then it returns the env value", async () => {
      // given
      process.env.HOME = "/Users/tester"
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${HOME}")

      // then
      expect(expanded).toBe("/Users/tester")
    })
  })

  describe("#given a sensitive environment variable listed in the user allowlist", () => {
    it("#when expanding the value #then it returns the env value", async () => {
      // given
      process.env.CUSTOM_API_KEY = "user-approved"
      setAdditionalAllowedMcpEnvVars(["CUSTOM_API_KEY"])
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${CUSTOM_API_KEY}")

      // then
      expect(expanded).toBe("user-approved")
    })
  })

  describe("#given a sensitive environment variable expanded in trusted mode", () => {
    it("#when expanding the value #then it returns the env value bypassing the allowlist", async () => {
      // given
      process.env.SLACK_USER_TOKEN = "xoxp-trusted"
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${SLACK_USER_TOKEN}", { trusted: true })

      // then
      expect(expanded).toBe("xoxp-trusted")
    })
  })

  describe("#given an unset env var expanded in trusted mode with a default", () => {
    it("#when expanding the value #then it returns the default value", async () => {
      // given
      delete process.env.UNSET_TRUSTED_VAR
      const { expandEnvVars } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVars("${UNSET_TRUSTED_VAR:-fallback}", { trusted: true })

      // then
      expect(expanded).toBe("fallback")
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
    it("#when expanding env vars in the object #then it only expands safe values", async () => {
      // given
      process.env.HOME = "/Users/tester"
      process.env.AWS_SECRET_ACCESS_KEY = "aws-secret"
      const { expandEnvVarsInObject } = await importFreshEnvExpanderModule()

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

  describe("#given a trusted skill MCP config object with sensitive env vars", () => {
    it("#when expanding env vars in trusted mode #then it expands all referenced env vars", async () => {
      // given
      process.env.SLACK_USER_TOKEN = "xoxp-trusted-token"
      process.env.HOME = "/Users/tester"
      const { expandEnvVarsInObject } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVarsInObject(
        {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            "https://mcp.slack.com/mcp",
            "--header",
            "Authorization:Bearer ${SLACK_USER_TOKEN}",
          ],
          env: {
            HOME_DIR: "${HOME}",
          },
        },
        { trusted: true }
      )

      // then
      expect(expanded).toEqual({
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          "https://mcp.slack.com/mcp",
          "--header",
          "Authorization:Bearer xoxp-trusted-token",
        ],
        env: {
          HOME_DIR: "/Users/tester",
        },
      })
    })

    it("#when expanding a remote http skill MCP config in trusted mode #then it expands sensitive headers", async () => {
      // given
      process.env.SLACK_USER_TOKEN = "xoxp-trusted-token"
      const { expandEnvVarsInObject } = await importFreshEnvExpanderModule()

      // when
      const expanded = expandEnvVarsInObject(
        {
          url: "https://mcp.slack.com/mcp",
          headers: {
            Authorization: "Bearer ${SLACK_USER_TOKEN}",
          },
        },
        { trusted: true }
      )

      // then
      expect(expanded).toEqual({
        url: "https://mcp.slack.com/mcp",
        headers: {
          Authorization: "Bearer xoxp-trusted-token",
        },
      })
    })
  })
})
