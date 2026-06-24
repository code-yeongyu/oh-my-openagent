import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CONTRIBUTING_PATH = join(import.meta.dir, "..", "CONTRIBUTING.md")

function readContributing(): string {
  return readFileSync(CONTRIBUTING_PATH, "utf8")
}

describe("CONTRIBUTING.md accuracy", () => {
  test("#given the contributor guide #when scanned for known-wrong tokens #then no stale defect survives", () => {
    // given
    const content = readContributing()

    // when
    // static scan of the rendered guide

    // then
    const forbidden: ReadonlyArray<readonly [token: string, defect: string]> = [
      ["oh-my-opencode/dist/index.js", "D1 broken local plugin path (wrong clone dir + wrong relative root)"],
      ["utils.ts", "D8/D13 prescribes a catch-all file the repo explicitly bans"],
      ["builtinTools", "D14 wrong tool registration entrypoint"],
      ["builtinAgents", "D9 wrong agent registration entrypoint"],
      ["onSessionStart", "D11/D12 invented hook handler shape"],
    ]
    for (const [token, defect] of forbidden) {
      expect(content, `must not document ${defect}`).not.toContain(token)
    }
  })

  test("#given the contributor guide #when scanned for the real registration entrypoints #then current symbols are documented", () => {
    // given
    const content = readContributing()

    // then
    const required: ReadonlyArray<readonly [token: string, why: string]> = [
      ["agentSources", "D9 real agent registry in agents/builtin-agents.ts"],
      ["@opencode-ai/sdk", "D9 real AgentConfig source"],
      ["tool-registry-factories", "D13 real tool registry layer"],
      ["createBuiltinMcps", "D15 real MCP registry function"],
      ["HookNameSchema", "D11 hook enable/disable registration"],
      ["file:///", "D1 absolute local plugin path form the installer accepts"],
    ]
    for (const [token, why] of required) {
      expect(content, `must document ${why}`).toContain(token)
    }
  })

  test("#given the contributor guide #when scanned for testing + QA discipline #then bun test, codex suite, and evidence rules are present", () => {
    // given
    const content = readContributing()

    // then
    expect(content).toContain("bun test")
    expect(content).toContain("test:codex")
    expect(content).toContain(".omo/evidence")
    expect(content).toContain("opencode-qa")
    expect(content).toContain("codex-qa")
  })

  test("#given the contributor guide #when scanned for the dev-environment sections #then cross-harness setup, credentials, and isolation are documented", () => {
    // given
    const content = readContributing()
    const lower = content.toLowerCase()

    // then
    expect(content).toContain("Development Environment")
    expect(content).toContain("script/agent/setup.sh")
    expect(content).toContain("script/agent/cleanup.sh")
    expect(content).toContain(".env.example")
    expect(lower).toContain("credential")
    expect(lower).toContain("isolat")
  })
})
