import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, win32 } from "node:path"

import { transformReasoningUnification } from "../config-migration/reasoning-unification"
import { BrowserAutomationProviderSchema } from "../config/schema/browser-automation"
import { prepareTargetWrite } from "../../../omo-config-core/src/migration/commit"
import { categoryShadowMessage } from "../../../senpi-task/src/agents/category-shadow"
import { doctorConfigLines } from "../../../omo-native/bin/lib/config-doctor.js"
import { warningsForSettings } from "../../../omo-native/bin/lib/doctor.js"
import { configDoctorLines } from "../../../omo-native/config-doctor-runtime"
import { runConfigMigrate } from "./config-migrate"
import { formatDoctorFailure } from "./doctor"
import { runCheck } from "./doctor/runner"
import { formatModelWithVariant } from "./doctor/checks/model-resolution-variant"
import { runOpenCodeStartupMigration } from "../startup-migration"
import { checkTuiPluginConfig } from "./doctor/checks/tui-plugin-config"
import { BrowserAutomationConfigSchema } from "../config/schema/browser-automation"
import { configIssueSummary } from "@oh-my-opencode/omo-config-core"
import { transformSubscriptionProviderRename } from "../config-migration/subscription-provider-rename"

const secret = "sk-test-DO-NOT-PRINT-0000"
const token = "eyJhbGciOiJub25lIn0.DO-NOT-PRINT.signature"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function noSecrets(value: unknown) {
  const text = JSON.stringify(value)
  expect(text).not.toContain(secret)
  expect(text).not.toContain(token)
}

describe("migration and doctor diagnostic security", () => {
  for (const [json, windowsPath] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    test(`migration ${json ? "JSON" : "text"} report hides every transform leaf and conflicting value${windowsPath ? " with a Windows short-name path" : ""}`, () => {
      const root = mkdtempSync(join(tmpdir(), "omo-report-security-"))
      roots.push(root)
      const home = windowsPath ? join(root, win32.join("RUNNER~1", "AppData", "Local", "Temp")) : root
      mkdirSync(join(home, ".omo"), { recursive: true })
      writeFileSync(join(home, ".omo", "config.jsonc"), JSON.stringify({
        "[opencode]": { provider: { custom: { apiKey: secret, headers: { Authorization: token }, options: [true, 123, null, "ordinary"] } } },
      }))
      const targetPath = join(home, ".omo", "omo.jsonc")
      writeFileSync(targetPath, JSON.stringify({
        "[opencode]": { provider: { custom: { apiKey: token, headers: { Authorization: secret } } } },
      }))
      const lines: string[] = []
      expect(runConfigMigrate({ cwd: home, environment: { HOME: home }, dryRun: true, json, output: (line) => lines.push(line) })).toBe(0)
      expect(lines.join("\n")).toContain("apiKey")
      if (!json) expect(lines.join("\n")).toContain(targetPath)
      noSecrets(lines)
      if (json) {
        const report = JSON.parse(lines.join("\n"))
        expect(report.migrations.map((entry: { targetPath?: string }) => entry.targetPath)).toContain(targetPath)
        expect(report.migrations.some((entry: { transform?: unknown }) => entry.transform !== undefined)).toBe(true)
        const leaves = (value: unknown): unknown[] => value !== null && typeof value === "object"
          ? Object.values(value).flatMap(leaves)
          : [value]
        for (const migration of report.migrations) {
          if (migration.transform !== undefined) expect(leaves(migration.transform).every((value) => value === "[redacted]")).toBe(true)
        }
      }
    })
  }

  test("reasoning conflicts name keys without serializing either value", () => {
    const result = transformReasoningUnification({
      categories: { quick: { model: "provider/model", reasoning: secret, variant: token } },
    })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toContain("categories.quick")
    noSecrets(result.diagnostics)
  })

  test("provider renaming never echoes free-form values that resemble model references", () => {
    const result = transformSubscriptionProviderRename({
      "[opencode]": { provider: { custom: { headers: { Authorization: `openai-codex/${secret}` } } } },
    })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toContain("Authorization")
    noSecrets(result.diagnostics)
  })

  test("migration validation errors name the invalid key without received data", () => {
    let error: unknown
    try {
      prepareTargetWrite({
        additions: { git_master: { git_env_prefix: secret } },
        migrationId: "security",
        target: {},
        targetPath: "omo.jsonc",
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("git_master.git_env_prefix")
    noSecrets(String(error))
  })

  test("browser validator errors do not quote arbitrary provider input", () => {
    const result = BrowserAutomationProviderSchema.safeParse(secret)
    expect(result.success).toBe(false)
    if (!result.success) noSecrets(result.error.issues)
    const wrongType = BrowserAutomationConfigSchema.safeParse({ playwright_mcp_args: secret })
    expect(wrongType.success).toBe(false)
    if (!wrongType.success) expect(wrongType.error.issues.map(configIssueSummary)).toContain("Expected array")
  })

  test("doctor category guidance keeps model ids but never provider options", () => {
    const message = categoryShadowMessage({
      categories: { oracle: { models: [{ model: "provider/model", provider_options: { apiKey: secret, headers: { Authorization: token } } }] } },
    }, "oracle")
    expect(message).toContain("including every model entry and its tuning/options")
    noSecrets(message)
  })

  test("doctor model identifiers remain visible but URL credentials do not", () => {
    expect(formatModelWithVariant("provider/model", "high")).toBe("provider/model (high)")
    noSecrets(formatModelWithVariant(`https://user:${secret}@example.test/model?token=${token}`))
    noSecrets(categoryShadowMessage({
      categories: { oracle: { model: `https://user:${secret}@example.test/model?token=${token}` } },
    }, "oracle"))
  })

  test("doctor runtime errors never print raw exception content", async () => {
    noSecrets(await doctorConfigLines({ loadRuntime: async () => { throw new Error(secret) } }))
  })

  test("unexpected doctor check errors never print raw exception content", async () => {
    const result = await runCheck({ id: "config", name: "Configuration", check: async () => { throw new Error(token) } })
    expect(result.status).toBe("fail")
    noSecrets(result)
  })

  test("unexpected doctor failure never prints raw exception or stack content", () => {
    noSecrets(formatDoctorFailure(new Error(secret)))
  })

  test("unexpected startup migration errors never print config content", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-startup-security-"))
    roots.push(home)
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "config.jsonc"), '{"[opencode]":{"model_fallback":true}}')
    const result = runOpenCodeStartupMigration({
      cwd: home,
      homeDir: home,
      env: { HOME: home },
      onBoundary: () => { throw new Error(secret) },
    })
    expect(result.error).toBeDefined()
    noSecrets(result.error)
  })

  test("doctor malformed settings names the file, not parser excerpts", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-settings-security-"))
    roots.push(home)
    const previous = process.env.OMO_CODING_AGENT_DIR
    process.env.OMO_CODING_AGENT_DIR = home
    try {
      writeFileSync(join(home, "settings.json"), `{"token":${secret}}`)
      const lines = warningsForSettings()
      expect(lines.join("\n")).toContain("settings.json")
      noSecrets(lines)
    } finally {
      if (previous === undefined) delete process.env.OMO_CODING_AGENT_DIR
      else process.env.OMO_CODING_AGENT_DIR = previous
    }
  })

  test("native doctor config output never prints ignored or nested option values", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-doctor-values-"))
    roots.push(home)
    mkdirSync(join(home, ".omo"))
    writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify({
      task: { default_concurrency: secret },
      unknown: { token },
      categories: { "plan-consultant": { models: [{ model: "provider/model", provider_options: { apiKey: secret } }] } },
    }))
    const lines = configDoctorLines({ cwd: home, env: { HOME: home } })
    expect(lines.join("\n")).toContain("task.default_concurrency")
    expect(lines.join("\n")).toContain("unknown")
    expect(lines.join("\n")).toContain("including every model entry and its tuning/options")
    noSecrets(lines)
  })

  test("doctor plugin-spec guidance strips URL userinfo and query values", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-doctor-plugin-url-"))
    roots.push(home)
    const previous = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = home
    try {
      writeFileSync(join(home, "opencode.json"), JSON.stringify({
        plugin: [`oh-my-openagent@https://user:${secret}@example.test/plugin.tgz?token=${token}`],
      }))
      writeFileSync(join(home, "tui.json"), '{"plugin":["oh-my-openagent/tui"]}')
      const result = await checkTuiPluginConfig()
      expect(result.status).toBe("warn")
      expect(JSON.stringify(result)).toContain("example.test")
      noSecrets(result)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previous
    }
  })
})
