import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { isImported, scenarioOverride } from "./replay-case"

const ROOT = resolve(import.meta.dir, "../../..")
const DRIVER = join(ROOT, "script/qa/computer/replay.ts")
const EXE = process.platform === "win32" ? ".exe" : ""

// The cargo target dir: CARGO_TARGET_DIR when set, else cargo's own target_directory, else <repo>/target.
async function targetDir(env: Readonly<Record<string, string | undefined>>): Promise<string> {
  const configured = env.CARGO_TARGET_DIR
  if (configured) return resolve(ROOT, configured)
  try {
    const proc = Bun.spawn(["cargo", "metadata", "--format-version", "1", "--no-deps"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "ignore",
    })
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    const meta: unknown = code === 0 ? JSON.parse(text) : undefined
    if (typeof meta === "object" && meta !== null && "target_directory" in meta) {
      const found = meta.target_directory
      if (typeof found === "string") return found
    }
  } catch (error) {
    console.warn(`cargo metadata unavailable, using <repo>/target: ${String(error)}`)
  }
  return join(ROOT, "target")
}

// The debug engine binary the tests build and run.
const engineIn = async (env: Readonly<Record<string, string | undefined>>) =>
  join(await targetDir(env), "debug", `omo-computer-engine${EXE}`)
const ENGINE = await engineIn(process.env)
const CASE_01 = join(
  ROOT,
  "crates/omo-computer-engine/tests/fixtures/v1-consumers/01-stdio-session-open-no-options.json",
)
const DELTAS_HEADER = "file\tpointer\tkind\tsource\trow\timported value\tv3 value"
const PROVENANCE = join(ROOT, "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv")

// A probe engine: records the arguments it was spawned with, then exits without replying.
const PROBE_ENGINE = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_ARGV_LOG, JSON.stringify(process.argv.slice(2)) + "\\n")
`

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

// A stand-in engine that reports its runtime dir and the state planted there: at start it logs
// the dir, then answers every request with what it saw before it read any request.
const PLANT_ENGINE = `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
const runtime = process.env.OMO_COMPUTER_RUNTIME_DIR ?? ""
const look = (rel) => {
  const path = join(runtime, rel)
  if (!existsSync(path)) return null
  const stat = statSync(path)
  return { mode: (stat.mode & 0o777).toString(8), content: stat.isDirectory() ? null : readFileSync(path, "utf8") }
}
const seen = { same: process.env.PROBE_RUNTIME === runtime, seed: look("seed/state.json"), locked: look("locked") }
appendFileSync(process.env.PROBE_ARGV_LOG, runtime + "\\n")
for await (const line of console) {
  if (line.trim() === "") continue
  const { id } = JSON.parse(line)
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: seen }) + "\\n")
}
`

type Run = { code: number; stdout: string; stderr: string }

let dir = ""
let scripted = ""
let probeEngine = ""
let plantEngine = ""

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

type CaseFile = { readonly path: string; readonly transport: unknown }
async function caseFile(path: string): Promise<CaseFile | undefined> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"))
  if (typeof raw !== "object" || raw === null || !("steps" in raw)) return undefined
  return { path, transport: "transport" in raw ? raw.transport : undefined }
}

// The imported oracle cases: every replay case the provenance manifest lists.
async function importedCases(): Promise<CaseFile[]> {
  const listed = (await readFile(PROVENANCE, "utf8"))
    .trim()
    .split("\n")
    .slice(1)
    .map((row) => join(ROOT, row.split("\t")[0] ?? ""))
  const cases = await Promise.all(listed.map(caseFile))
  return cases.filter((item): item is CaseFile => item !== undefined)
}

async function v3Cases(): Promise<CaseFile[]> {
  const paths = await Array.fromAsync(
    new Bun.Glob("crates/**/fixtures/**/v3-*.json").scan({ cwd: ROOT, absolute: true }),
  )
  const cases = await Promise.all(paths.map(caseFile))
  return cases.filter((item): item is CaseFile => item !== undefined)
}

// Replays `casePath` against the probe engine: the run, and each spawn's arguments.
async function probe(casePath: string): Promise<{ run: Run; argv: unknown[] }> {
  counter += 1
  const log = join(dir, `argv-${counter}.log`)
  const run = await replay(["--engine", probeEngine, "--case", casePath], { PROBE_ARGV_LOG: log })
  const text = (await Bun.file(log).exists()) ? await readFile(log, "utf8") : ""
  return {
    run,
    argv: text
      .trim()
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line)),
  }
}

// A stand-in engine runnable on every OS: the script itself where its shebang runs it, and a
// binary compiled for this host on Windows, which cannot spawn a script.
async function standIn(name: string, source: string): Promise<string> {
  const script = join(dir, `${name}.ts`)
  await writeFile(script, source)
  if (process.platform !== "win32") {
    await chmod(script, 0o755)
    return script
  }
  const binary = join(dir, `${name}.exe`)
  const build = Bun.spawn(["bun", "build", "--compile", script, "--outfile", binary], {
    stdout: "inherit",
    stderr: "inherit",
  })
  expect(await build.exited).toBe(0)
  return binary
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "omo-replay-test-"))
  scripted = await standIn("scripted-engine", SCRIPTED_ENGINE)
  probeEngine = await standIn("probe-engine", PROBE_ENGINE)
  plantEngine = await standIn("plant-engine", PLANT_ENGINE)
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
    expect(run.stdout).toContain(
      "REPLAY_OK crates/omo-computer-engine/tests/fixtures/v1-consumers/01-stdio-session-open-no-options.json steps=2",
    )
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
    const relaxed = await scriptedCase(steps, plan, [
      "<case>\t/result/a\tadditive\ttest\t15\t\t",
      "*\t/result/*\tadditive\ttest\t15\t\t",
    ])
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

    const leaky = await scriptedCase(
      steps,
      [
        { replies: [reply(1, null)], sink: 1 },
        { replies: [reply(2, null)], sink: 1 },
      ],
      [],
    )
    const refused = await replay(leaky.args, leaky.env)
    expect(refused.stdout).toContain("sink")
    expect(refused.stdout).toContain("step=2")
    expect(refused.code).toBe(1)
  }, 60_000)

  test("a leftover message fails the case", async () => {
    const steps = [{ send: request(1), expect: [expectation(reply(1, {}))] }]
    const extra = await scriptedCase(
      steps,
      [{ replies: [reply(1, {}), { jsonrpc: "2.0", method: "audit", params: {} }] }],
      [],
    )
    const run = await replay(extra.args, extra.env)
    expect(run.stdout).toContain("LEFTOVER")
    expect(run.code).toBe(1)
  }, 60_000)

  test("every input or setup error exits 2, never 1", async () => {
    const notJson = join(dir, "not-json.json")
    await writeFile(notJson, "{ not json")
    const badTransport = join(dir, "bad-transport.json")
    await writeFile(badTransport, JSON.stringify({ transport: "carrier-pigeon", steps: [] }))
    const runs = {
      "case file that is not JSON": await replay(["--engine", ENGINE, "--case", notJson]),
      "missing case file": await replay(["--engine", ENGINE, "--case", join(dir, "absent.json")]),
      "missing engine": await replay(["--engine", join(dir, "absent-engine"), "--case", CASE_01]),
      "malformed case": await replay(["--engine", ENGINE, "--case", badTransport]),
      "missing --engine": await replay(["--case", CASE_01]),
    }
    for (const [what, run] of Object.entries(runs)) {
      expect({ what, code: run.code, error: run.stdout.includes("REPLAY_ERROR") }).toEqual({
        what,
        code: 2,
        error: true,
      })
    }
  }, 60_000)

  test("every imported oracle case without a transport replays as stdio", async () => {
    const cases = (await importedCases()).filter((item) => item.transport === undefined)
    expect(cases.length).toBeGreaterThan(0)
    for (const item of cases) {
      const { run, argv } = await probe(item.path)
      expect({ case: item.path, code: run.code, first: argv[0] }).toEqual({
        case: item.path,
        code: 1,
        first: ["--stdio"],
      })
    }
  }, 120_000)

  test("every v3- case without a transport is refused with transport_missing and spawns nothing", async () => {
    const synthetic = join(dir, "v3-no-transport.json")
    await writeFile(synthetic, JSON.stringify({ steps: [{ send: request(1), expect: [] }] }))
    const cases = [
      ...(await v3Cases()).filter((item) => item.transport === undefined).map((item) => item.path),
      synthetic,
    ]
    for (const path of cases) {
      const { run, argv } = await probe(path)
      const typed = run.stdout.includes("REPLAY_ERROR transport_missing")
      expect({ path, code: run.code, typed, spawned: argv.length }).toEqual({ path, code: 2, typed: true, spawned: 0 })
    }
  }, 60_000)

  test("a case with an explicit transport is replayed over that transport", async () => {
    const synthetic = join(dir, "v3-explicit-mcp.json")
    await writeFile(synthetic, JSON.stringify({ transport: "mcp", steps: [{ send: request(1), expect: [] }] }))
    const cases = [...(await importedCases()), ...(await v3Cases()), { path: synthetic, transport: "mcp" }]
    const explicit = cases.filter((item) => item.transport !== undefined)
    expect(explicit.length).toBeGreaterThan(1)
    for (const item of explicit) {
      const { argv } = await probe(item.path)
      expect({ case: item.path, first: argv[0] }).toEqual({ case: item.path, first: [`--${String(item.transport)}`] })
    }
  }, 120_000)

  test("replay_skips_an_old_case_its_superseding_case_names_in_a_list_or_directory", async () => {
    counter += 1
    const cases = join(dir, `supersedes-${counter}`)
    await mkdir(cases)
    const steps = [{ send: request(1), expect: [expectation(reply(1, { a: 1 }))] }]
    const plan = join(dir, `supersedes-plan-${counter}.json`)
    await writeFile(plan, JSON.stringify([{ replies: [reply(1, { a: 1 })] }]))
    const failing = [{ send: request(1), expect: [expectation(reply(1, { a: 2 }))] }]
    await writeFile(join(cases, "old.json"), JSON.stringify({ transport: "stdio", steps: failing }))
    await writeFile(join(cases, "new.json"), JSON.stringify({ transport: "stdio", supersedes: ["old.json"], steps }))
    const env = { SCRIPTED_ENGINE_PLAN: plan }
    const listed = await replay(
      ["--engine", scripted, "--case", join(cases, "new.json"), "--case", join(cases, "old.json")],
      env,
    )
    const whole = await replay(["--engine", scripted, "--dir", cases], env)
    for (const run of [listed, whole]) {
      expect(run.stdout).toContain("SKIPPED old.json superseded by new.json")
      expect(run.stdout).toContain("steps=1")
      expect(run.stdout).not.toContain("MISMATCH")
      expect(run.code).toBe(0)
    }
  }, 60_000)

  test("replay_fails_when_a_superseding_case_names_a_missing_old_case", async () => {
    counter += 1
    const cases = join(dir, `supersedes-missing-${counter}`)
    await mkdir(cases)
    const steps = [{ send: request(1), expect: [] }]
    await writeFile(join(cases, "new.json"), JSON.stringify({ transport: "stdio", supersedes: ["absent.json"], steps }))
    const log = join(dir, `argv-supersedes-missing-${counter}.log`)
    const run = await replay(["--engine", probeEngine, "--case", join(cases, "new.json")], { PROBE_ARGV_LOG: log })
    expect(run.stdout).toContain("REPLAY_ERROR supersedes_missing")
    expect(run.stdout).toContain("absent.json")
    expect(run.code).toBe(2)
    expect(await Bun.file(log).exists()).toBe(false)
  }, 60_000)

  test("replay_fails_the_list_when_the_superseding_case_fails", async () => {
    counter += 1
    const cases = join(dir, `supersedes-failing-${counter}`)
    await mkdir(cases)
    const plan = join(dir, `supersedes-failing-plan-${counter}.json`)
    await writeFile(plan, JSON.stringify([{ replies: [reply(1, { a: 1 })] }]))
    const steps = [{ send: request(1), expect: [expectation(reply(1, { a: 1 }))] }]
    const failing = [{ send: request(1), expect: [expectation(reply(1, { a: 2 }))] }]
    await writeFile(join(cases, "old.json"), JSON.stringify({ transport: "stdio", steps }))
    await writeFile(
      join(cases, "new.json"),
      JSON.stringify({ transport: "stdio", supersedes: ["old.json"], steps: failing }),
    )
    const run = await replay(
      ["--engine", scripted, "--case", join(cases, "new.json"), "--case", join(cases, "old.json")],
      { SCRIPTED_ENGINE_PLAN: plan },
    )
    expect(run.stdout).toContain("SKIPPED old.json superseded by new.json")
    expect(run.stdout).toContain("MISMATCH")
    expect(run.code).toBe(1)
  }, 60_000)

  test("the engine path follows CARGO_TARGET_DIR", async () => {
    const target = join(dir, "private-target")
    expect(await engineIn({ CARGO_TARGET_DIR: target })).toBe(join(target, "debug", `omo-computer-engine${EXE}`))
  })

  test("replay_runs_each_case_in_a_fresh_runtime_dir_with_its_planted_state", async () => {
    counter += 1
    const cases = join(dir, `plant-${counter}`)
    await mkdir(cases)
    const seen = { same: true, seed: { mode: "600", content: "hello" }, locked: { mode: "500", content: null } }
    const planted = {
      transport: "stdio",
      env: { PROBE_RUNTIME: "$" + "{RUNTIME_DIR}" },
      runtime: {
        plant: [
          { path: "seed/state.json", content: "hello", mode: "0600" },
          { path: "locked", dir: true, mode: "0500" },
        ],
      },
      steps: [{ send: request(1), expect: [expectation(reply(1, seen))] }],
    }
    await writeFile(join(cases, "a.json"), JSON.stringify(planted))
    await writeFile(join(cases, "b.json"), JSON.stringify(planted))
    const log = join(dir, `plant-runtime-${counter}.log`)
    const run = await replay(["--engine", plantEngine, "--dir", cases], { PROBE_ARGV_LOG: log })
    expect(run.stdout).not.toContain("MISMATCH")
    expect(run.stdout.match(/steps=1/g)?.length).toBe(2)
    expect(run.code).toBe(0)
    const dirs = (await readFile(log, "utf8")).trim().split("\n")
    expect(dirs.length).toBe(2)
    expect(new Set(dirs).size).toBe(2)
    for (const used of dirs) expect(await Bun.file(join(used, "seed/state.json")).exists()).toBe(false)
  }, 60_000)

  test("replay_never_hands_a_case_another_cases_leftovers", async () => {
    counter += 1
    const cases = join(dir, `leftover-${counter}`)
    await mkdir(cases)
    const seen = { same: true, seed: { mode: "600", content: "hello" }, locked: null }
    const steps = [{ send: request(1), expect: [expectation(reply(1, seen))] }]
    const env = { PROBE_RUNTIME: "$" + "{RUNTIME_DIR}" }
    const plant = [{ path: "seed/state.json", content: "hello", mode: "0600" }]
    await writeFile(
      join(cases, "1-plants.json"),
      JSON.stringify({ transport: "stdio", env, runtime: { plant }, steps }),
    )
    await writeFile(join(cases, "2-relies.json"), JSON.stringify({ transport: "stdio", env, steps }))
    const log = join(dir, `leftover-runtime-${counter}.log`)
    const run = await replay(["--engine", plantEngine, "--dir", cases], { PROBE_ARGV_LOG: log })
    expect(run.stdout).toContain("steps=1")
    expect(run.stdout).toContain("MISMATCH")
    expect(run.stdout).toContain("2-relies.json")
    expect(run.stdout).not.toMatch(/MISMATCH \S*1-plants\.json/)
    expect(run.code).toBe(1)
  }, 60_000)

  test("replay_follows_a_supersedes_chain_and_fails_on_a_missing_link", async () => {
    counter += 1
    const cases = join(dir, `chain-${counter}`)
    await mkdir(cases)
    const plan = join(dir, `chain-plan-${counter}.json`)
    await writeFile(plan, JSON.stringify([{ replies: [reply(1, { a: 1 })] }]))
    const passing = [{ send: request(1), expect: [expectation(reply(1, { a: 1 }))] }]
    const failing = [{ send: request(1), expect: [expectation(reply(1, { a: 2 }))] }]
    await writeFile(join(cases, "a.json"), JSON.stringify({ transport: "stdio", steps: failing }))
    await writeFile(
      join(cases, "b.json"),
      JSON.stringify({ transport: "stdio", supersedes: ["a.json"], steps: failing }),
    )
    await writeFile(
      join(cases, "c.json"),
      JSON.stringify({ transport: "stdio", supersedes: ["b.json"], steps: passing }),
    )
    const run = await replay(["--engine", scripted, "--dir", cases], { SCRIPTED_ENGINE_PLAN: plan })
    expect(run.stdout).toContain("SKIPPED a.json superseded by b.json")
    expect(run.stdout).toContain("SKIPPED b.json superseded by c.json")
    expect(run.stdout.match(/steps=1/g)?.length).toBe(1)
    expect(run.code).toBe(0)

    const broken = join(dir, `chain-broken-${counter}`)
    await mkdir(broken)
    await writeFile(
      join(broken, "c.json"),
      JSON.stringify({ transport: "stdio", supersedes: ["b.json"], steps: passing }),
    )
    const missing = await replay(["--engine", scripted, "--dir", broken], { SCRIPTED_ENGINE_PLAN: plan })
    expect(missing.stdout).toContain("REPLAY_ERROR supersedes_missing")
    expect(missing.code).toBe(2)
  }, 60_000)

  test("--assert-sink-empty fails when the sink holds an entry", async () => {
    const steps = [{ send: request(1, "click"), expect: [expectation(reply(1, null))] }]
    const sent = await scriptedCase(steps, [{ replies: [reply(1, null)], sink: 1 }], [])
    const run = await replay([...sent.args, "--assert-sink-empty"], sent.env)
    expect(run.stdout).toContain("sink")
    expect(run.code).toBe(1)
  }, 60_000)
})

describe("SCENARIO-OVERRIDES.tsv (R70bj)", () => {
  const dir = join(ROOT, "crates/omo-computer-core/fixtures/conformance")
  const rows = readFileSync(join(dir, "v3-scenario-overrides.tsv"), "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split("\t"))

  test("every row names an existing imported case and an existing fixture", async () => {
    expect(rows.length).toBe(9)
    for (const [file, scenario] of rows) {
      expect(file.startsWith("crates/omo-computer-core/fixtures/conformance/")).toBe(true)
      expect(existsSync(join(ROOT, file))).toBe(true)
      expect(await isImported(join(ROOT, file))).toBe(true)
      expect(existsSync(join(ROOT, scenario))).toBe(true)
      expect(await scenarioOverride(join(ROOT, file))).toBe(scenario)
    }
  })

  test("a case that is not in the table loads its own scenario", async () => {
    expect(await scenarioOverride(join(dir, "v3-consent-identity-changed.json"))).toBeUndefined()
  })

  // Review L8 at a07dff9 (R70cl): the table keys on the repository-relative path, so a case with
  // the same file name in another conformance tree is never redirected.
  test("a case of the same name elsewhere is not redirected", async () => {
    const elsewhere = join(ROOT, "crates/senpi-desktop-core/fixtures/conformance/frame-invalidation.json")
    expect(await scenarioOverride(elsewhere)).toBeUndefined()
    expect(await scenarioOverride(join(dir, "frame-invalidation.json"))).toBeDefined()
  })

  test("a missing table is an error, never an empty table", async () => {
    await expect(scenarioOverride(join(dir, "frame-invalidation.json"), join(dir, "no-such-overrides.tsv"))).rejects.toThrow(
      "scenario_overrides_unreadable",
    )
  })
})
