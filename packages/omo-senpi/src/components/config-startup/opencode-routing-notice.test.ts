import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parse } from "jsonc-parser"

import type { SenpiOmoConfigResult } from "../config-resolution"
import { notificationMessages, runSenpiStartupMigration } from "./index"

const NOTICE_MIGRATION_ID = "2026-09-opencode-routing-notice"
const EMPTY_CONFIG: SenpiOmoConfigResult = { config: {}, diagnostics: [], layers: [], sources: [] }

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function tempHome(omoJsonc?: string): string {
  const home = mkdtempSync(join(tmpdir(), "omo-routing-notice-"))
  homes.push(home)
  if (omoJsonc !== undefined) {
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "omo.jsonc"), omoJsonc)
  }
  return home
}

function start(home: string) {
  const migration = runSenpiStartupMigration({
    cwd: join(home, "project"),
    env: { HOME: home },
    environment: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    homeDir: home,
  })
  return { migration, notices: notificationMessages(migration, EMPTY_CONFIG).map((notice) => notice.message) }
}

function omoText(home: string): string {
  return readFileSync(join(home, ".omo", "omo.jsonc"), "utf8")
}

describe("OpenCode edition model settings at Native startup", () => {
  test("#given an OpenCode edition config and no omo setup #when Native starts twice #then one notice lists every setting under its native key and the second start is quiet", () => {
    // given
    const home = tempHome()
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(join(home, ".config", "opencode", "oh-my-openagent.json"), JSON.stringify({
      agents: {
        metis: { model: "zai-coding-plan/glm-5.2" },
        momus: { model: "kimi-for-coding/k3", variant: "high" },
        oracle: { model: "openai/gpt-5.5" },
      },
      categories: { quick: { model: "kimi-for-coding/k3" } },
    }))

    // when
    const first = start(home)
    const afterFirst = omoText(home)
    const second = start(home)

    // then
    const reports = first.notices.filter((message) => message.includes("metis"))
    expect(reports).toHaveLength(1)
    for (const token of ["plan-consultant", "zai/glm-5.2", "momus", "plan-reviewer", "kimi-coding/k3", "\"reasoning\": \"high\"", "oracle", "openai/gpt-5.5", "quick", "omo setup"]) {
      expect(reports[0]).toContain(token)
    }
    const config = parse(afterFirst)
    expect(config["[native]"]).toBeUndefined()
    expect(config["_migrations"]).toContain(NOTICE_MIGRATION_ID)
    expect(second.migration.results.every((result) => result.status === "skipped")).toBe(true)
    expect(second.notices).toEqual([])
    expect(omoText(home)).toBe(afterFirst)
  })

  test("#given a Native plan-consultant already configured #when Native starts #then metis is not reported and the config keeps its values and comments", () => {
    // given
    const home = tempHome('{\n  // mine\n  "[native]": { "agents": { "plan-consultant": { "model": "anthropic/claude-opus-5-5" } } },\n  "[opencode]": { "agents": { "metis": { "model": "zai-coding-plan/glm-5.2" }, "momus": { "model": "zai-coding-plan/glm-5.2" } } }\n}\n')

    // when
    const { notices } = start(home)

    // then
    const text = notices.join("\n")
    expect(text).toContain("plan-reviewer")
    expect(text).not.toContain("metis")
    expect(omoText(home)).toContain("// mine")
    expect(parse(omoText(home))["[native]"]).toEqual({ agents: { "plan-consultant": { model: "anthropic/claude-opus-5-5" } } })
  })

  test("#given the OpenCode block sets both metis and plan-consultant #when Native starts #then the Native name's setting is the one reported", () => {
    // given
    const home = tempHome(JSON.stringify({
      "[opencode]": { agents: { metis: { model: "zai-coding-plan/glm-5.2" }, "plan-consultant": { model: "kimi-for-coding/k3" } } },
    }))

    // when
    const text = start(home).notices.join("\n")

    // then
    expect(text).toContain("kimi-coding/k3")
    expect(text).not.toContain("glm-5.2")
  })

  test("#given an agent on a provider omo does not know #when Native starts #then the report names its native key", () => {
    // given
    const home = tempHome(JSON.stringify({ "[opencode]": { agents: { momus: { model: "acme/acme-large" } } } }))

    // when
    const reports = start(home).notices.filter((message) => message.includes("momus"))

    // then
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("acme")
    expect(reports[0]).toContain("plan-reviewer")
  })

  test("#given no OpenCode edition history #when Native starts #then omo.jsonc stays byte-identical and nothing is reported", () => {
    // given
    const original = '{\n  "_migrations": ["2026-08-reasoning-unification"],\n  "[native]": { "model_profile": "daily-normal" }\n}\n'
    const home = tempHome(original)

    // when
    const { notices } = start(home)

    // then
    expect(omoText(home)).toBe(original)
    expect(notices).toEqual([])
  })
})
