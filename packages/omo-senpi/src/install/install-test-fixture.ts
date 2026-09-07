import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const REQUIRED_SKILL_NAMES = [
  "ast-grep",
  "coding-agent-sessions",
  "debugging",
  "frontend",
  "git-master",
  "init-deep",
  "lsp-setup",
  "programming",
  "refactor",
  "remove-ai-slops",
  "review-work",
  "ultimate-browsing",
  "ultrawork",
  "ulw-execute",
  "ulw-loop",
  "ulw-plan",
  "ulw-research",
  "visual-qa",
] as const

export async function createPluginFixture(options: { readonly runtime?: boolean } = { runtime: true }): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-senpi-plugin-fixture-"))
  await writeFixtureFile(join(pluginPath, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
  await writeFixtureFile(join(pluginPath, "extensions", "omo.js"), "export default {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-task.js"), "export const createTaskComponent = () => ({})\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-member.js"), "export default {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "memory-run-supervisor.mjs"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "reflection-persona.md"), "# reflection persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "dream-persona.md"), "# dream persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "facts-persona.md"), "# facts persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "memorian-persona.md"), "# memorian persona fixture\n")
  for (const skillName of REQUIRED_SKILL_NAMES) {
    await writeFixtureFile(join(pluginPath, "skills", skillName, "SKILL.md"), `# ${skillName}\n`)
  }
  // Credential-gated skill: staged outside pi.skills but still a required payload artifact.
  await writeFixtureFile(join(pluginPath, "skills-conditional", "x-search", "SKILL.md"), "# x-search\n")
  await writeFixtureFile(join(pluginPath, "scripts", "install.mjs"), "#!/usr/bin/env node\n")
  if (options.runtime !== false) {
    const astGrepRuntime = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
    await writeFixtureFile(astGrepRuntime, "console.log('ast-grep')\n")
    await chmod(astGrepRuntime, 0o755)
    const astGrepRuntimeBytes = await readFile(astGrepRuntime)
    await writeFixtureFile(
      join(pluginPath, "runtime", "ast-grep-mcp", "manifest.json"),
      `${JSON.stringify({
        sha256: createHash("sha256").update(astGrepRuntimeBytes).digest("hex"),
        mode: 0o755,
        stagedAtUtc: "2026-08-03T00:00:00.000Z",
      }, null, 2)}\n`,
    )
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "cli.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "ulw-loop", "cli.js"), "console.log('ulw-loop')\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "omo-agent-toolkit"), "#!/bin/sh\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "omo-agent-toolkit.cmd"), "@echo off\r\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "cli.js"), "console.log('cli')\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.d.ts"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.d.ts"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "package.json"), JSON.stringify({ version: "0.1.0" }))
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"), "{}\n")
  }
  return pluginPath
}

export async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}
