import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const EXPECTED_OMO_COMPONENT_BINS = [
  { name: "omo", target: join("dist", "cli", "index.js"), kind: "runtime-wrapper" },
  { name: "omo-comment-checker", target: join("components", "comment-checker", "dist", "cli.js") },
  { name: "omo-git-bash-hook", target: join("components", "git-bash", "dist", "cli.js") },
  { name: "lazycodex-executor-verify", target: join("components", "lazycodex-executor-verify", "dist", "cli.js") },
  { name: "omo-lsp", target: join("components", "lsp", "dist", "cli.js") },
  { name: "omo-rules", target: join("components", "rules", "dist", "cli.js") },
  { name: "omo-start-work-continuation", target: join("components", "start-work-continuation", "dist", "cli.js") },
  { name: "omo-telemetry", target: join("components", "telemetry", "dist", "cli.js") },
  { name: "omo-ulw-loop", target: join("components", "ulw-loop", "dist", "cli.js") },
  { name: "ulw", target: join("components", "ulw-loop", "dist", "cli.js") },
  { name: "ulw-loop", target: join("components", "ulw-loop", "dist", "cli.js") },
  { name: "omo-ultrawork", target: join("components", "ultrawork", "dist", "cli.js") },
] as const

export function expectedBinName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name
}

export async function createRepoWithBuiltComponentBins(
  input: {
    readonly includeBundledGitBashMcp?: boolean
    readonly includeRootCliDist?: boolean
  } = {},
): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-built-bins-repo-"))
  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const pluginRoot = join(codexPackageRoot, "plugin")

  await mkdir(join(repoRoot, "src"), { recursive: true })
  await mkdir(codexPackageRoot, { recursive: true })
  await writeFile(join(repoRoot, "src", "index.ts"), "export {}\n")
  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "4.7.5" }))
  await writeFile(
    join(codexPackageRoot, "marketplace.json"),
    JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: "./plugins/omo" }] }),
  )

  if (input.includeRootCliDist !== false) {
    await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
    await writeFile(join(repoRoot, "dist", "cli", "index.js"), "#!/usr/bin/env node\n")
  }

  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  const pluginManifest =
    input.includeBundledGitBashMcp === true
      ? { name: "omo", version: "0.1.0", hooks: "hooks/hooks.json" }
      : { name: "omo", version: "0.1.0" }
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify(pluginManifest))
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@sisyphuslabs/omo-codex-plugin", version: "0.1.0" }))

  if (input.includeBundledGitBashMcp === true) {
    await createBundledGitBashMcpFixture({ pluginRoot, repoRoot })
  }

  const componentBins = new Map<string, Record<string, string>>()
  for (const entry of EXPECTED_OMO_COMPONENT_BINS) {
    if ("kind" in entry && entry.kind === "runtime-wrapper") continue
    const componentName = entry.target.split(/[\\/]/)[1]
    if (componentName === undefined) throw new Error(`missing component name for ${entry.name}`)
    const bins = componentBins.get(componentName) ?? {}
    bins[entry.name] = "./dist/cli.js"
    componentBins.set(componentName, bins)
  }

  for (const [componentName, bins] of componentBins) {
    const componentRoot = join(pluginRoot, "components", componentName)
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: `@sisyphuslabs/${componentName}`, bin: bins }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
  }

  return repoRoot
}

async function createBundledGitBashMcpFixture(input: { readonly pluginRoot: string; readonly repoRoot: string }): Promise<void> {
  await mkdir(join(input.pluginRoot, "hooks"), { recursive: true })
  await writeFile(
    join(input.pluginRoot, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "node ./components/git-bash/dist/cli.js hook pre-tool-use" }],
          },
        ],
        PostCompact: [
          {
            hooks: [{ type: "command", command: "node ./components/git-bash/dist/cli.js hook post-compact" }],
          },
        ],
      },
    }),
  )
  await writeFile(
    join(input.pluginRoot, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        git_bash: {
          command: "node",
          args: ["../../git-bash-mcp/dist/cli.js", "mcp"],
          cwd: ".",
        },
      },
    }),
  )
  await mkdir(join(input.repoRoot, "packages", "git-bash-mcp", "dist"), { recursive: true })
  await writeFile(join(input.repoRoot, "packages", "git-bash-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n")
}
