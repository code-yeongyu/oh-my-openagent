/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const INSTALL_CODEX_LEGACY_AGENT_PURGE_TIMEOUT_MS = 20_000

const LEGACY_MANAGED_ULTRAWORK_REVIEWER_TOML = `name = "codex-ultrawork-reviewer"
description = "Strict ultrawork verification reviewer. Use after full QA evidence to audit the diff, goal, and scenario evidence before declaring done."
nickname_candidates = ["Verifier"]
model = "gpt-5.5"
model_reasoning_effort = "high"
developer_instructions = """You are the ultrawork verification reviewer.

Review only. Do not implement.

The default model intentionally uses a ChatGPT account compatible frontier model. If a caller supplies a different supported reviewer model, follow the caller's assignment while preserving this review contract.

Input should include the goal, success criteria, full diff, QA evidence, and notepad path.
If Codex delivers parent review context as inter-agent commentary, treat the latest parent message with goal/diff/evidence as your active review assignment, not passive context.
If the latest parent message starts with \`TASK STILL ACTIVE:\`, immediately return the requested verdict or \`BLOCKED: <reason>\` instead of continuing silently.

Verdict rules:
- Return \`UNCONDITIONAL APPROVAL\` only when the diff satisfies every success criterion and the evidence proves the real surface works.
- Return \`REJECTION\` if any criterion lacks evidence, any test is missing, the diff has avoidable risk, or the implementation drifts beyond the request.
- Treat "looks good but..." as rejection. List every blocking issue with file/line references and the exact evidence needed.

Be concise, specific, and strict."""
`

describe("install-codex legacy agent purge", () => {
  test("#given retired managed reviewer artifacts and user agents #when installing omo #then purges only managed legacy reviewer artifacts", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-retired-reviewer-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-retired-reviewer-"))
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(codexHome, "config.toml"),
      [
        "[agents.codex-ultrawork-reviewer]",
        'config_file = "./agents/codex-ultrawork-reviewer.toml"',
        "",
        "[agents.user_custom]",
        'config_file = "./agents/user-custom.toml"',
        "",
      ].join("\n"),
    )
    await writeFile(join(agentsDir, "codex-ultrawork-reviewer.toml"), LEGACY_MANAGED_ULTRAWORK_REVIEWER_TOML)
    await writeFile(join(agentsDir, "user-custom.toml"), 'name = "user-custom"\nmodel = "gpt-5.5"\n')

    // when
    await runCodexInstaller({ codexHome, binDir, repoRoot: process.cwd(), runCommand: async () => undefined })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).not.toContain("[agents.codex-ultrawork-reviewer]")
    expect(configContent).not.toContain('config_file = "./agents/codex-ultrawork-reviewer.toml"')
    expect(await pathExists(join(agentsDir, "codex-ultrawork-reviewer.toml"))).toBe(false)
    expect(await readFile(join(agentsDir, "user-custom.toml"), "utf8")).toBe('name = "user-custom"\nmodel = "gpt-5.5"\n')
  }, { timeout: INSTALL_CODEX_LEGACY_AGENT_PURGE_TIMEOUT_MS })

  test("#given custom file using retired reviewer filename #when installing omo #then preserves the unproven user TOML", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-custom-reviewer-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-custom-reviewer-"))
    const agentsDir = join(codexHome, "agents")
    const customReviewer = 'name = "codex-ultrawork-reviewer"\ndescription = "My local reviewer override"\n'
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(codexHome, "config.toml"),
      ["[agents.codex-ultrawork-reviewer]", 'config_file = "./agents/codex-ultrawork-reviewer.toml"', ""].join("\n"),
    )
    await writeFile(join(agentsDir, "codex-ultrawork-reviewer.toml"), customReviewer)

    // when
    await runCodexInstaller({ codexHome, binDir, repoRoot: process.cwd(), runCommand: async () => undefined })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).not.toContain("[agents.codex-ultrawork-reviewer]")
    expect(await readFile(join(agentsDir, "codex-ultrawork-reviewer.toml"), "utf8")).toBe(customReviewer)
  }, { timeout: INSTALL_CODEX_LEGACY_AGENT_PURGE_TIMEOUT_MS })
})

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
