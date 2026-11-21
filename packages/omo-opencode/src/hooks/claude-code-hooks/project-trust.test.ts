const { afterEach, beforeEach, describe, expect, test } = require("bun:test")
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const { resolveProjectTrust } = await import("./project-trust")

describe("resolveProjectTrust", () => {

  let originalClaudeConfigDir: string | undefined
  let originalTrustEnv: string | undefined
  let tempHome = ""
  let projectDir = ""
  let claudeConfigDir = ""

  beforeEach(() => {
    //#given
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalTrustEnv = process.env.OMO_CLAUDE_SETTINGS_TRUST
    tempHome = mkdtempSync(join(tmpdir(), "omo-claude-project-trust-"))
    projectDir = join(tempHome, "project")
    claudeConfigDir = join(tempHome, ".claude")
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(claudeConfigDir, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
    delete process.env.OMO_CLAUDE_SETTINGS_TRUST
  })

  afterEach(() => {
    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }
    if (originalTrustEnv === undefined) {
      delete process.env.OMO_CLAUDE_SETTINGS_TRUST
    } else {
      process.env.OMO_CLAUDE_SETTINGS_TRUST = originalTrustEnv
    }
    rmSync(tempHome, { recursive: true, force: true })
  })

  test("#given no recorded trust decision #when trust is resolved #then the project is untrusted by default", async () => {
    //#given
    writeClaudeGlobalConfig({})

    //#when
    const decision = await resolveProjectTrust(projectDir)

    //#then
    expect(decision.trusted).toBe(false)
    expect(decision.source).toBe("no-decision")
  })

  test("#given Claude Code recorded hasTrustDialogAccepted=true #when trust is resolved #then the project is trusted", async () => {
    //#given
    writeClaudeGlobalConfig({
      projects: { [resolve(projectDir)]: { hasTrustDialogAccepted: true } },
    })

    //#when
    const decision = await resolveProjectTrust(projectDir)

    //#then
    expect(decision.trusted).toBe(true)
    expect(decision.source).toBe("claude-trust-dialog")
  })

  test("#given Claude Code recorded hasTrustDialogAccepted=false #when trust is resolved #then the project is untrusted", async () => {
    //#given
    writeClaudeGlobalConfig({
      projects: { [resolve(projectDir)]: { hasTrustDialogAccepted: false } },
    })

    //#when
    const decision = await resolveProjectTrust(projectDir)

    //#then
    expect(decision.trusted).toBe(false)
    expect(decision.source).toBe("claude-trust-dialog")
  })

  test("#given no recorded decision and OMO_CLAUDE_SETTINGS_TRUST=1 #when trust is resolved #then the project is trusted via env opt-in", async () => {
    //#given
    process.env.OMO_CLAUDE_SETTINGS_TRUST = "1"

    //#when
    const decision = await resolveProjectTrust(projectDir)

    //#then
    expect(decision.trusted).toBe(true)
    expect(decision.source).toBe("env-opt-in")
  })

  test("#given explicit deny and OMO_CLAUDE_SETTINGS_TRUST=1 #when trust is resolved #then the explicit deny wins", async () => {
    //#given
    process.env.OMO_CLAUDE_SETTINGS_TRUST = "1"
    writeClaudeGlobalConfig({
      projects: { [resolve(projectDir)]: { hasTrustDialogAccepted: false } },
    })

    //#when
    const decision = await resolveProjectTrust(projectDir)

    //#then
    expect(decision.trusted).toBe(false)
    expect(decision.source).toBe("claude-trust-dialog")
  })

  test("#given a malformed .claude.json #when trust is resolved #then the project falls back to untrusted by default", async () => {
    //#given
    writeFileSync(join(claudeConfigDir, ".claude.json"), "{ not json")

    //#when
    const decision = await resolveProjectTrust(projectDir)

    //#then
    expect(decision.trusted).toBe(false)
    expect(decision.source).toBe("no-decision")
  })

  function writeClaudeGlobalConfig(config: unknown): void {
    writeFileSync(join(claudeConfigDir, ".claude.json"), JSON.stringify(config))
  }
})

export {}
