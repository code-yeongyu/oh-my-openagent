import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../../..")
const DRIVER = join(ROOT, "script/qa/computer/replay.ts")
const ENGINE = join(ROOT, "target/debug/omo-computer-engine")
const CASE_01 = join(ROOT, "crates/omo-computer-engine/tests/fixtures/v1-consumers/01-stdio-session-open-no-options.json")
const DELTAS_HEADER = "file\tpointer\tkind\tsource\trow\timported value\tv3 value"

// A scripted stand-in for the engine: for the n-th request line it appends `sink` lines to
// its sink file under the runtime directory, then writes the n-th reply list.
const SCRIPTED_ENGINE = `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs"
const plan = JSON.parse(readFileSync(process.env.SCRIPTED_ENGINE_PLAN, "utf8"))
const sink = process.env.OMO_COMPUTER_RUNTIME_DIR + "/fake-sink-" + process.pid + ".log"
appendFileSync(sink, "")
let n = 0
for await (const line of console) {
  if (line.trim() === "") continue
  const step = plan[n++] ?? { replies: [] }
  for (let i = 0; i < (step.sink ?? 0); i++) appendFileSync(sink, "post_input tag=" + i + "\\n")
  for (const reply of step.replies) process.stdout.write(JSON.stringify(reply) + "\\n")
}
`

type Run = { code: number; stdout: string; stderr: string }

let dir = ""
let scripted = ""

async function replay(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const proc = Bun.spawn(["bun", DRIVER, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

type Step = { send: unknown; expect: unknown[]; sink?: number }
type Reply = { replies: unknown[]; sink?: number }

let counter = 0
async function scriptedCase(
  steps: Step[],
  plan: Reply[],
  deltas: string[],
): Promise<{ args: string[]; env: Record<string, string>; casePath: string }> {
  counter += 1
  const casePath = join(dir, `case-${counter}.json`)
  const planPath = join(dir, `plan-${counter}.json`)
  const deltasPath = join(dir, `deltas-${counter}.tsv`)
  await writeFile(casePath, JSON.stringify({ description: "scripted", transport: "stdio", env: {}, steps }))
  await writeFile(planPath, JSON.stringify(plan))
  const lines = deltas.map((line) => line.replaceAll("<case>", casePath))
  await writeFile(deltasPath, [DELTAS_HEADER, ...lines].join("\n") + "\n")
  return {
    args: ["--engine", scripted, "--case", casePath, "--deltas", deltasPath],
    env: { SCRIPTED_ENGINE_PLAN: planPath },
    casePath,
  }
}

const request = (id: number, method = "capabilities") => ({ jsonrpc: "2.0", id, method, params: {} })
const reply = (id: number, result: unknown) => ({ jsonrpc: "2.0", id, result })
const expectation = (message: unknown, variable: string[] = []) => ({ message, variable })

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "omo-replay-test-"))
  scripted = join(dir, "scripted-engine.ts")
  await writeFile(scripted, SCRIPTED_ENGINE)
  await chmod(scripted, 0o755)
  const build = Bun.spawn(["cargo", "build", "-p", "omo-computer-engine", "--locked"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  })
  expect(await build.exited).toBe(0)
}, 600_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("replay driver", () => {
  test("v1 corpus case 01-stdio-session-open-no-options replays", async () => {
    const run = await replay(["--engine", ENGINE, "--case", CASE_01])
    expect(run.stdout).toContain("REPLAY_OK crates/omo-computer-engine/tests/fixtures/v1-consumers/01-stdio-session-open-no-options.json steps=2")
    expect(run.stdout).toContain("procs 0")
    expect(run.stdout).toContain("dir REMOVED ")
    expect(run.code).toBe(0)
  }, 60_000)

  test("a mismatching reply exits 1 and prints the JSON pointer", async () => {
    const changed = JSON.parse(await readFile(CASE_01, "utf8"))
    changed.steps[1].expect[0].message.result.displayCount = 3
    const casePath = join(dir, "01-changed.json")
    await writeFile(casePath, JSON.stringify(changed))
    const run = await replay(["--engine", ENGINE, "--case", casePath])
    expect(run.stdout).toContain("/result/displayCount")
    expect(run.stdout).not.toContain("REPLAY_OK")
    expect(run.code).toBe(1)
  }, 60_000)

  test("replay_accepts_an_extra_member_only_when_a_delta_line_matches_it", async () => {
    const steps = [{ send: request(1), expect: [expectation(reply(1, { a: 1 }))] }]
    const plan = [{ replies: [reply(1, { a: 1, extra: { deep: true } })] }]

    const unlisted = await scriptedCase(steps, plan, [])
    const refused = await replay(unlisted.args, unlisted.env)
    expect(refused.stdout).toContain("/result/extra")
    expect(refused.code).toBe(1)

    const exact = await scriptedCase(steps, plan, ["<case>\t/result/extra\tadditive\ttest\t15\t\t"])
    const accepted = await replay(exact.args, exact.env)
    expect(accepted.stdout).toContain("steps=1")
    expect(accepted.code).toBe(0)
    expect(accepted.stderr).toContain("matched=1")

    const wildcard = await scriptedCase(steps, plan, ["*\t**/extra\tadditive\ttest\t15\t\t"])
    const anyPrefix = await replay(wildcard.args, wildcard.env)
    expect(anyPrefix.code).toBe(0)

    const otherFile = await scriptedCase(steps, plan, ["crates/elsewhere.json\t/result/extra\tadditive\ttest\t15\t\t"])
    const notThisCase = await replay(otherFile.args, otherFile.env)
    expect(notThisCase.stdout).toContain("/result/extra")
    expect(notThisCase.code).toBe(1)
  }, 60_000)

  test("replay_never_relaxes_a_member_the_imported_expectation_lists", async () => {
    const steps = [{ send: request(1), expect: [expectation(reply(1, { a: 1, b: "x" }))] }]
    const plan = [{ replies: [reply(1, { a: 2, b: "x" })] }]
    const relaxed = await scriptedCase(steps, plan, ["<case>\t/result/a\tadditive\ttest\t15\t\t", "*\t/result/*\tadditive\ttest\t15\t\t"])
    const run = await replay(relaxed.args, relaxed.env)
    expect(run.stdout).toContain("/result/a")
    expect(run.code).toBe(1)
  }, 60_000)

  test("replay_compares_a_replaced_pointer_with_the_v3_value_and_fails_on_the_imported_one", async () => {
    const steps = [{ send: request(1), expect: [expectation(reply(1, { focusRestoration: "not_needed" }))] }]
    const line = '<case>\t/result/focusRestoration\treplaced\ttest\t15\t"not_needed"\t"untouched"'

    const v3 = await scriptedCase(steps, [{ replies: [reply(1, { focusRestoration: "untouched" })] }], [line])
    const accepted = await replay(v3.args, v3.env)
    expect(accepted.code).toBe(0)
    expect(accepted.stderr).toContain("matched=1")

    const imported = await scriptedCase(steps, [{ replies: [reply(1, { focusRestoration: "not_needed" })] }], [line])
    const refused = await replay(imported.args, imported.env)
    expect(refused.stdout).toContain("/result/focusRestoration")
    expect(refused.code).toBe(1)
  }, 60_000)

  test("replay_step_sink_count_fails_when_a_refused_call_adds_an_entry", async () => {
    const steps = [
      { send: request(1, "click"), expect: [expectation(reply(1, null))], sink: 1 },
      { send: request(2, "click"), expect: [expectation(reply(2, null))], sink: 1 },
    ]

    const clean = await scriptedCase(steps, [{ replies: [reply(1, null)], sink: 1 }, { replies: [reply(2, null)] }], [])
    const accepted = await replay(clean.args, clean.env)
    expect(accepted.stdout).toContain("steps=2")
    expect(accepted.code).toBe(0)

    const leaky = await scriptedCase(steps, [{ replies: [reply(1, null)], sink: 1 }, { replies: [reply(2, null)], sink: 1 }], [])
    const refused = await replay(leaky.args, leaky.env)
    expect(refused.stdout).toContain("sink")
    expect(refused.stdout).toContain("step=2")
    expect(refused.code).toBe(1)
  }, 60_000)

  test("a leftover message fails the case", async () => {
    const steps = [{ send: request(1), expect: [expectation(reply(1, {}))] }]
    const extra = await scriptedCase(steps, [{ replies: [reply(1, {}), { jsonrpc: "2.0", method: "audit", params: {} }] }], [])
    const run = await replay(extra.args, extra.env)
    expect(run.stdout).toContain("LEFTOVER")
    expect(run.code).toBe(1)
  }, 60_000)

  test("--assert-sink-empty fails when the sink holds an entry", async () => {
    const steps = [{ send: request(1, "click"), expect: [expectation(reply(1, null))] }]
    const sent = await scriptedCase(steps, [{ replies: [reply(1, null)], sink: 1 }], [])
    const run = await replay([...sent.args, "--assert-sink-empty"], sent.env)
    expect(run.stdout).toContain("sink")
    expect(run.code).toBe(1)
  }, 60_000)
})
