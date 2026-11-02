import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNonInteractiveEnvHook } from "../../hooks/non-interactive-env"
import { openCodeShellTypeResolver } from "../../shared/opencode-shell"
import { resolveSkillContent } from "./skill-content"

const roots: string[] = []

function configureShell(name: string): void {
  const root = mkdtempSync(join(tmpdir(), "omo-opencode-shell-"))
  roots.push(root)
  const shell = join(root, name)
  writeFileSync(shell, "")
  chmodSync(shell, 0o755)
  openCodeShellTypeResolver.setConfiguredShell(shell)
}

async function hookPrefix(): Promise<string> {
  const hook = createNonInteractiveEnvHook({} as Parameters<typeof createNonInteractiveEnvHook>[0])
  const output: { args: Record<string, unknown> } = { args: { command: "git status" } }
  await hook["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, output)
  return output.args.command as string
}

afterEach(() => {
  openCodeShellTypeResolver.setConfiguredShell(undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("git-master prompt and non-interactive-env agree on the shell OpenCode runs (#9733)", () => {
  test("#given OpenCode is configured to run pwsh #when git-master resolves #then both use PowerShell syntax", async () => {
    configureShell("pwsh")

    const content = resolveSkillContent("git-master", { gitMasterConfig: { commit_footer: false, git_env_prefix: "GIT_MASTER=1" } })

    expect(content).toContain("$env:GIT_MASTER='1';")
    expect(await hookPrefix()).toStartWith("$env:")
  })

  test("#given OpenCode is configured to run bash #when git-master resolves #then both use unix syntax", async () => {
    configureShell("bash")

    const content = resolveSkillContent("git-master", { gitMasterConfig: { commit_footer: false, git_env_prefix: "GIT_MASTER=1" } })

    expect(content).toContain("GIT_MASTER=1 git")
    expect(content).not.toContain("$env:GIT_MASTER")
    expect(await hookPrefix()).toStartWith("export ")
  })
})
