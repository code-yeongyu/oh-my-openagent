/// <reference types="bun-types" />

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { getPrometheusPrompt } from "../agents/prometheus/system-prompt"
import { getAgentListDisplayName } from "./agent-display-names"
import { reconcileNativeModelPrompts } from "../agents/native-model-prompt"

const DIST_INDEX = "dist/index.js"
const PROMETHEUS_SOURCE = "packages/prompts-core/prompts/prometheus/default.md"
const CONFIGURED_MODEL = "anthropic/claude-opus-5-5"
const BUNDLE_PROBE_SCRIPT = `
const [distUrl, projectDirectory] = process.argv.slice(1);
const module = await import(distUrl);
const hooks = await module.default.server({
  directory: projectDirectory,
  client: {},
  serverUrl: new URL("http://127.0.0.1:1"),
}, {});
try {
  const config = {};
  await hooks.config(config);
  const agents = Object.values(config.agent ?? {}).filter(
    (entry) => typeof entry === "object" && entry !== null && typeof entry.prompt === "string",
  );
  const toolSnippets = Object.fromEntries(Object.entries(hooks.tool ?? {}).map(([name, tool]) => [name, tool.description]));
  process.stdout.write(JSON.stringify({ agents, toolSnippets }));
} finally {
  await hooks.dispose?.();
}
`

type RuntimeAgent = {
  name?: string
  model?: string
  mode?: unknown
  permission?: unknown
  prompt: string
}

describe("dist bundle prompt content", () => {
  test("#given the built plugin bundle #when its runtime agent factory is executed #then its composed prompt and role equal their source artifacts", async () => {
    const distIndex = Bun.file(DIST_INDEX)
    expect(await distIndex.exists(), `${DIST_INDEX} must exist before this CI-only test runs`).toBe(true)

    const fixtureRoot = await mkdtemp(join(tmpdir(), "omo-dist-prompt-"))
    const homeDirectory = join(fixtureRoot, "home")
    const projectDirectory = join(fixtureRoot, "project")
    await Promise.all([
      Bun.write(join(homeDirectory, ".keep"), ""),
      Bun.write(join(projectDirectory, ".keep"), ""),
      Bun.write(join(projectDirectory, ".omo", "omo.jsonc"), JSON.stringify({
        agents: { prometheus: { model: CONFIGURED_MODEL } },
      })),
    ])

    try {
      const node = Bun.which("node")
      expect(node, "node is required to execute the published ESM bundle seam").not.toBeNull()
      const child = Bun.spawn({
        cmd: [
          node!,
          "--input-type=module",
          "-e",
          BUNDLE_PROBE_SCRIPT,
          new URL(`../../../../${DIST_INDEX}`, import.meta.url).href,
          projectDirectory,
        ],
        cwd: process.cwd(),
        env: {
          ...Bun.env,
          HOME: homeDirectory,
          XDG_CONFIG_HOME: join(homeDirectory, ".config"),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(exitCode, `${stdout}\n${stderr}`.trim()).toBe(0)

      const { agents: runtimeAgents, toolSnippets } = JSON.parse(stdout) as {
        agents: RuntimeAgent[]
        toolSnippets: Record<string, string>
      }

      const sourcePrompt = await readFile(PROMETHEUS_SOURCE, "utf8")
      const runtimeAgent = runtimeAgents.find((agent) => agent.name === getAgentListDisplayName("prometheus"))
      expect(runtimeAgent, "Prometheus was not returned by the built plugin runtime").toBeDefined()
      if (!runtimeAgent) throw new Error("Missing bundled Prometheus agent")
      expect(runtimeAgent.model).toBe(CONFIGURED_MODEL)
      const metadata = JSON.parse(runtimeAgent.prompt.slice("<omo-model-core>".length).split("\n")[0])
      const expected = [getPrometheusPrompt(CONFIGURED_MODEL)]
      reconcileNativeModelPrompts(expected, CONFIGURED_MODEL, toolSnippets, metadata.toolPermissions)
      expect(runtimeAgent.prompt).toBe(expected[0])
      expect(toolSnippets.grep).toBeDefined()
      expect(runtimeAgent.prompt).toContain("- grep: " + toolSnippets.grep)
      const frameEnd = "\n</omo-model-core>\n\n"
      const roleOffset = runtimeAgent.prompt.indexOf(frameEnd)
      expect(roleOffset).toBeGreaterThanOrEqual(0)
      expect(runtimeAgent.prompt.slice(roleOffset + frameEnd.length)).toBe(sourcePrompt)
      expect(runtimeAgent).toMatchObject({
        mode: "primary",
        permission: {
          call_omo_agent: "deny",
          edit: "allow",
          question: "allow",
          task: "allow",
          webfetch: "allow",
        },
      })
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  }, 30_000)
})
