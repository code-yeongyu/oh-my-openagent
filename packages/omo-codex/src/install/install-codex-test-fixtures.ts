import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const EXPECTED_GIT_BASH_HOOKS = [
  "./hooks/pre-tool-use-recommending-git-bash-mcp.json",
  "./hooks/post-compact-resetting-git-bash-mcp-reminder.json",
] as const

export const EXPECTED_OMO_COMPONENT_BINS = [
  { name: "omo-agent-toolkit", target: join("dist", "cli", "index.js"), kind: "runtime-wrapper" },
  { name: "omo-comment-checker", target: join("components", "comment-checker", "dist", "cli.js") },
  { name: "omo-git-bash-hook", target: join("components", "git-bash", "dist", "cli.js") },
  { name: "lazycodex-executor-verify", target: join("components", "lazycodex-executor-verify", "dist", "cli.js") },
  { name: "omo-lsp", target: join("components", "lsp", "dist", "cli.js") },
  { name: "omo-rules", target: join("components", "rules", "dist", "cli.js") },
  { name: "omo-telemetry", target: join("components", "telemetry", "dist", "cli.js") },
  { name: "omo-ulw-execute-continuation", target: join("components", "ulw-execute-continuation", "dist", "cli.js") },
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
    readonly agentNames?: readonly string[]
    readonly includeBundledGitBashMcp?: boolean
    readonly includeComponentBins?: boolean
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

  if (input.agentNames !== undefined) {
    const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents")
    await mkdir(agentsRoot, { recursive: true })
    await Promise.all(
      input.agentNames.map((agentName) =>
        writeFile(join(agentsRoot, `${agentName}.toml`), `name = "${agentName}"\n`, "utf8"),
      ),
    )
  }

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
    await writeFile(
      join(componentRoot, "package.json"),
      JSON.stringify({
        name: `@sisyphuslabs/${componentName}`,
        ...(input.includeComponentBins === false ? {} : { bin: bins }),
      }),
    )
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
  }

  return repoRoot
}

export async function createRepoWithGitBashHooksFixture(sourceRepoRoot: string): Promise<string> {
  const repoRoot = await createRepoWithBuiltComponentBins({
    includeBundledGitBashMcp: true,
    includeComponentBins: false,
    includeRootCliDist: false,
  })
  const sourcePluginRoot = join(sourceRepoRoot, "packages", "omo-codex", "plugin")
  const fixturePluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")
  const sourceManifest: unknown = JSON.parse(
    await readFile(join(sourcePluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
  )
  if (!isRecord(sourceManifest) || !Array.isArray(sourceManifest.hooks)) {
    throw new Error("shipped Codex plugin manifest must declare hook files")
  }

  const sourceHooks = new Set(sourceManifest.hooks.filter((hook): hook is string => typeof hook === "string"))
  if (!EXPECTED_GIT_BASH_HOOKS.every((hook) => sourceHooks.has(hook))) {
    throw new Error("shipped Codex plugin manifest is missing Git Bash hook declarations")
  }
  const gitBashHooks = EXPECTED_GIT_BASH_HOOKS

  await writeFile(
    join(fixturePluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "omo", version: "0.1.0", hooks: gitBashHooks }),
  )
  for (const hook of gitBashHooks) {
    const relativeHookPath = hook.startsWith("./") ? hook.slice(2) : hook
    await copyFile(join(sourcePluginRoot, relativeHookPath), join(fixturePluginRoot, relativeHookPath))
  }
  const bootstrapScriptPath = join("components", "bootstrap", "scripts", "node-dispatch.ps1")
  await mkdir(join(fixturePluginRoot, "components", "bootstrap", "scripts"), { recursive: true })
  await copyFile(join(sourcePluginRoot, bootstrapScriptPath), join(fixturePluginRoot, bootstrapScriptPath))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
