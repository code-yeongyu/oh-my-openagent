import { describe, expect, test } from "bun:test"
import { AST_GREP_MCP_TOOLS, AST_GREP_REGISTERED, astGrepProbeCode, binaryOnlyFailures, compareRuns, normalizeText, PARITY_STEPS } from "./qa/omo-native-parity-compare.mjs"

const REGISTERED = `${AST_GREP_REGISTERED}${AST_GREP_MCP_TOOLS.join(", ")}`

function run(overrides: Partial<Parameters<typeof compareRuns>[0]> = {}) {
  const results = Object.fromEntries(PARITY_STEPS.map((step) => [step.id, { isError: false, text: step.id === "ast-grep" ? REGISTERED : `${step.id} ok` }]))
  return {
    tools: ["eval", "read", "webfetch"],
    results,
    doctor: ["PASS extension: plugin/extensions/omo.js", "INFO Update: omo update", "WARN task categories: 0 of 10 usable"],
    setup: ["No OpenCode setup found", "  categories    0 of 10 usable with these providers"],
    extensionFailures: [],
    exitCodes: { session: 0, doctor: 0, setup: 0 },
    ...overrides,
  }
}

describe("binary/npm parity comparison", () => {
  test("#given identical runs #when compared #then there is no difference", () => {
    expect(compareRuns(run(), run())).toEqual([])
  })

  test("#given the binary lacks a tool and fails a step #when compared #then both differences are reported", () => {
    const binary = run({ tools: ["read", "webfetch"] })
    binary.results["eval-js"] = { isError: true, text: "Tool eval not found" }
    const differences = compareRuns(binary, run())
    expect(differences.some((line) => line.startsWith('tools: npm registers "eval"'))).toBe(true)
    expect(differences.some((line) => line.startsWith("eval-js: binary error"))).toBe(true)
  })

  test("#given the binary doctor misses a section #when compared #then the missing section is reported", () => {
    const binary = run({ doctor: ["PASS extension: plugin/extensions/omo.js", "INFO Update: omo update"] })
    expect(compareRuns(binary, run())).toEqual(['doctor: npm prints "WARN task categories", the binary does not'])
  })

  test("#given distribution-specific doctor lines #when compared #then they are not differences", () => {
    const npm = run({ doctor: [...run().doctor, "PASS senpi version 2026.9.29-5", "INFO computer use engine: not installed yet"] })
    const binary = run({ doctor: [...run().doctor, "INFO omo 5.1.4 (engine: senpi 2026.9.29-5)", "PASS computer use engine: native/senpi-desktop-engine", "INFO Claude Code 2.1.284: not downloaded yet"] })
    expect(compareRuns(binary, npm)).toEqual([])
  })

  test("#given an extension load failure on one side #when compared #then it is reported", () => {
    const binary = run({ extensionFailures: ["Warning: Failed to load extension codemode"] })
    expect(compareRuns(binary, run())).toEqual(["binary: Warning: Failed to load extension codemode"])
  })

  test("#given a binary-only run whose pty step fails and session exits non-zero #when checked #then both are failures", () => {
    const broken = run({ exitCodes: { session: 1, doctor: 0, setup: 0 } })
    broken.results["pty-bash"] = { isError: true, text: "@earendil-works/pi-pty package.json is missing a string version" }
    expect(binaryOnlyFailures("first run", run())).toEqual([])
    expect(binaryOnlyFailures("first run", broken)).toEqual([
      "first run: session exited 1",
      'first run: pty-bash failed "@earendil-works/pi-pty package.json is missing a string version"',
    ])
  })

  test("#given a side whose ast-grep MCP tools never registered #when compared #then it is reported even when both sides agree", () => {
    const never = "ast-grep MCP tools never registered within 45s; listed: none"
    const late = run()
    late.results["ast-grep"] = { isError: false, text: never }
    expect(compareRuns(run(), late)).toEqual([`ast-grep: npm "${never}"`, `ast-grep: binary ok "${REGISTERED}" vs npm ok "${never}"`])
    expect(compareRuns(late, late)).toEqual([`ast-grep: binary "${never}"`, `ast-grep: npm "${never}"`])
  })

  test("#given the ast-grep probe cell #when its MCP tools register late or never #then it waits for all three or reports the timeout", async () => {
    const bullet = (name: string) => `- ${name} — desc`
    const probe = async (listed: (call: number) => readonly string[], options: { budgetMs: number; pollMs: number }) => {
      let calls = 0
      const printed: string[] = []
      const tool = { tool_search: async () => ({ text: ["Found tools:", "", ...listed(++calls).map(bullet)].join("\n") }) }
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
      await new AsyncFunction("tool", "print", astGrepProbeCode(options))(tool, (line: string) => printed.push(line))
      return { calls, printed }
    }
    const late = await probe((call) => (call < 3 ? [...AST_GREP_MCP_TOOLS.filter((name) => !name.endsWith("_search")), "mcp__ast_grep_search_hint"] : ["lsp_find", ...AST_GREP_MCP_TOOLS]), { budgetMs: 60_000, pollMs: 0 })
    expect(late).toEqual({ calls: 3, printed: [REGISTERED] })
    const never = await probe(() => [AST_GREP_MCP_TOOLS[0] ?? ""], { budgetMs: 0, pollMs: 0 })
    expect(never).toEqual({ calls: 1, printed: [`ast-grep MCP tools never registered within 0s; listed: ${AST_GREP_MCP_TOOLS[0]}`] })
  })

  test("#given sandbox paths and timings #when normalized #then they collapse to stable tokens", () => {
    expect(normalizeText("/tmp/x/home/a.txt elapsedMs=41 searched=9 in 12ms", ["/tmp/x"])).toBe("<root>/home/a.txt elapsedMs=<n> searched=<n> in <n>ms")
  })
})
