import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { REPO_ROOT } from "./registry"
import { type CliScenario, type LoopParseScenario, type Scenario, SCENARIOS, type ToolScenario } from "./scenarios"
import { discoverOmoTools, openToolSession } from "./tool-registry"

// Runs the scenario table against one tree and records each outcome, normalized so that the merge base and the head
// can be compared byte for byte: the sandbox, the tree and the temp directory are replaced by fixed names.

export type Outcome = Readonly<Record<string, unknown>>

const ENTRY: Readonly<Record<CliScenario["surface"], string>> = {
  native: "packages/omo-native/bin/omo.js",
  opencode: "packages/omo-opencode/src/cli/index.ts",
}
const CLI_BUDGET_MS = 30_000

const normalizer =
  (pairs: readonly (readonly [string, string])[]) =>
  (text: string): string =>
    pairs.reduce((acc, [from, to]) => acc.split(from).join(to), text).replace(/\u001b\[[0-9;]*m/g, "")

async function runCli(tree: string, scenario: CliScenario): Promise<Outcome> {
  const sandbox = mkdtempSync(join(tmpdir(), "sdk-parity-cli-"))
  const home = join(sandbox, "home")
  const cwd = join(sandbox, "cwd")
  mkdirSync(home)
  mkdirSync(cwd)
  try {
    const child = Bun.spawn([process.execPath, join(tree, ENTRY[scenario.surface]), ...scenario.argv], {
      cwd,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: home,
        TMPDIR: sandbox,
        TERM: "dumb",
        NO_COLOR: "1",
        OMO_SERVICE_API_URL: "http://127.0.0.1:9",
        OMO_SERVICE_ACCOUNTS_URL: "http://127.0.0.1:9",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: CLI_BUDGET_MS,
      killSignal: "SIGKILL",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const clean = normalizer([
      [sandbox, "<sandbox>"],
      [tree, "<tree>"],
    ])
    return { exit, stdout: clean(stdout), stderr: clean(stderr) }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

async function runTools(tree: string, scenarios: readonly ToolScenario[]): Promise<Map<string, Outcome>> {
  const outcomes = new Map<string, Outcome>()
  if (scenarios.length === 0) return outcomes
  const session = await openToolSession(tree)
  const clean = normalizer([
    [tree, "<tree>"],
    [tmpdir(), "<tmp>"],
  ])
  try {
    for (const scenario of scenarios) {
      try {
        outcomes.set(scenario.id, {
          result: JSON.parse(clean(JSON.stringify((await session.execute(scenario.tool, scenario.args)) ?? null))),
        })
      } catch (error) {
        outcomes.set(scenario.id, { threw: clean(error instanceof Error ? error.message : String(error)) })
      }
    }
  } finally {
    await session.close()
  }
  return outcomes
}

const LOOP_PARSER = "packages/omo-codex/plugin/components/ulw-loop/src/cli-arg-parser.ts"

async function runLoopParse(tree: string, scenario: LoopParseScenario): Promise<Outcome> {
  const parser = (await import(join(tree, LOOP_PARSER))) as { positionalText: (argv: readonly string[]) => string }
  return { brief: parser.positionalText(scenario.argv) }
}

async function runScenarios(
  tree: string,
  scenarios: readonly Scenario[] = SCENARIOS,
): Promise<Record<string, Outcome>> {
  const tools = await runTools(
    tree,
    scenarios.filter((scenario): scenario is ToolScenario => scenario.surface === "tool"),
  )
  const out: Record<string, Outcome> = {}
  for (const scenario of scenarios)
    out[scenario.id] =
      scenario.surface === "tool"
        ? (tools.get(scenario.id) ?? {})
        : scenario.surface === "loop-parse"
          ? await runLoopParse(tree, scenario)
          : await runCli(tree, scenario)
  return out
}

if (import.meta.main) {
  const at = (flag: string): string | undefined => {
    const index = process.argv.indexOf(flag)
    return index < 0 ? undefined : process.argv[index + 1]
  }
  const tree = at("--tree") ?? REPO_ROOT
  const outcomes = await runScenarios(tree)
  const side = process.argv.includes("--with-tools") ? { outcomes, tools: await discoverOmoTools(tree) } : outcomes
  const text = `${JSON.stringify(side, null, 2)}\n`
  const out = at("--out")
  if (out === undefined) process.stdout.write(text)
  else writeFileSync(out, text)
  process.exit(0)
}
