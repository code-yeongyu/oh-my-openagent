import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Finding, RuleId } from "./check-test-junk"

const script = join(import.meta.dir, "check-test-junk.ts")
let root = ""

async function run(args: readonly string[]): Promise<{ readonly code: number; readonly findings: readonly Finding[] }> {
  const child = Bun.spawn([process.execPath, script, "--json", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  const parsed: { readonly findings: readonly Finding[] } = JSON.parse(stdout)
  return { code, findings: parsed.findings }
}

const JUNK_TS = `import { readFileSync } from "node:fs"
test("source grep", () => {
  const source = readFileSync("src/parser.ts", "utf8")
  expect(source).toContain("export function parse")
})
test("prose pin", () => {
  const skill = readFileSync("SKILL.md", "utf8")
  expect(skill).toContain("You are a senior engineer")
})
test("sleeps", async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
})
test.only("focused", () => {})
it.skip("parked", () => {})
test("self compare", () => {
  expect(config.prompt).toEqual(config.prompt)
})
test("lower bound", () => {
  expect(masked.length).toBeGreaterThanOrEqual(3)
})
test("opted out", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50)) // test-junk-ok: fixed-sleep debounce window is the behavior under test
})
`

const CLEAN_TS = `import { readFileSync } from "node:fs"
test("parses a date when the input has a timezone", () => {
  expect(parse("2026-01-01T00:00:00Z")).toEqual({ year: 2026 })
})
test("the packaged skill equals its source", () => {
  const source = readFileSync("skills/x/SKILL.md", "utf8")
  const packaged = readFileSync("dist/skills/x/SKILL.md", "utf8")
  expect(packaged).toBe(source)
})
test("the bundle keeps the runtime entry", () => {
  const bundle = readFileSync("dist/index.js", "utf8")
  expect(bundle.length).toBeGreaterThan(0)
  expect(parseExports(bundle)).toEqual(["main"])
})
test("yields one tick before asserting", async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(flushed).toBe(true)
})
`

const JUNK_PY = `import time
def test_sleeps():
    time.sleep(1)
def test_lower():
    assert len(items) >= 2
def test_lower_nested():
    assert len(select(items)) > 1
def test_prose():
    body = Path("SKILL.md").read_text()
    assert "You are" in body
`

const JUNK_GO = `func TestSleeps(t *testing.T) {
\ttime.Sleep(100 * time.Millisecond)
\tt.Skip("flaky")
}
`

describe("#given test files with mechanically detectable junk", () => {
  beforeAll(() => {
    root = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), "check-test-junk-"))
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src", "junk.test.ts"), JUNK_TS)
    writeFileSync(join(root, "src", "clean.test.ts"), CLEAN_TS)
    writeFileSync(join(root, "src", "test_junk.py"), JUNK_PY)
    writeFileSync(join(root, "src", "junk_test.go"), JUNK_GO)
    writeFileSync(join(root, "src", "parser.ts"), "export const parse = () => readFileSync('x.ts')\n")
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test("#when the TypeScript fixture is scanned #then every class is reported at its line and the opted-out line is not", async () => {
    const { code, findings } = await run(["src/junk.test.ts"])
    const byRule = new Map<RuleId, number[]>()
    for (const finding of findings) byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding.line])
    expect(code).toBe(1)
    expect(byRule.get("source-grep")).toEqual([4])
    expect(byRule.get("prose-pin")).toEqual([8])
    expect(byRule.get("fixed-sleep")).toEqual([11])
    expect(byRule.get("focused")).toEqual([13])
    expect(byRule.get("skipped")).toEqual([14])
    expect(byRule.get("self-compare")).toEqual([16])
    expect(byRule.get("lower-bound")).toEqual([19])
  })

  test("#when Python and Go fixtures are scanned #then their sleep, skip and lower-bound forms are reported", async () => {
    const { findings } = await run(["src/test_junk.py", "src/junk_test.go"])
    expect(findings.map((finding) => [finding.file.split("/").at(-1), finding.line, finding.rule])).toEqual([
      ["test_junk.py", 3, "fixed-sleep"],
      ["test_junk.py", 5, "lower-bound"],
      ["test_junk.py", 7, "lower-bound"],
      ["test_junk.py", 10, "prose-pin"],
      ["junk_test.go", 2, "fixed-sleep"],
      ["junk_test.go", 3, "skipped"],
    ])
  })

  test("#when a clean test file and a production file are scanned #then nothing is reported and the exit code is 0", async () => {
    const { code, findings } = await run(["src/clean.test.ts", "src/parser.ts"])
    expect(findings).toEqual([])
    expect(code).toBe(0)
  })
})
