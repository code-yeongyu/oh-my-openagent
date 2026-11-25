#!/usr/bin/env bun
// The X1a proof (#14962): the scenario of scenario.ts run three times, each surface on its own, against one two-device
// world (world/world.ts), then the evidence: one transcript per surface (local, under --evidence-dir, default
// .omo/evidence/<date>-sdk-proof-x1a) and the summary table, rewritten in RESULTS.md beside this file.
//   bun run build:senpi-plugin
//   THREAD_QA_SENPI_VERSION=<the engine omo pins> bun script/qa/sdk-proof/run.ts [--evidence-dir <dir>] [--only sdk,tools,cli]
// A failing or unavailable cell is a finding: it names the slice that fixes it. Nothing here makes a cell pass.
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { createCliDriver } from "./drivers/cli.ts"
import { cellOf, turnOf } from "./cell.ts"
import type { Answer, Driver } from "./drivers/driver.ts"
import { createToolsDriver } from "./drivers/tools.ts"
import { type Cell, redact, type StepRecord, summary, type Surface, SURFACES, transcript } from "./evidence.ts"
import { fill, SCENARIO } from "./scenario.ts"
import { startSdkDriver } from "./world/sdk-process.ts"
import { CANARY, DEVICE_A, DEVICE_B, type Isolation, startWorld, type World } from "./world/world.ts"
import { outsideWriteRoots } from "./world/write-roots.ts"

const REPO = resolve(import.meta.dir, "..", "..")
const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const driverFor = async (surface: Surface, world: World): Promise<Driver> => {
  const env = world.a.env
  switch (surface) {
    case "sdk":
      return startSdkDriver({
        entry: join(world.install.plugin, "runtime", "thread-sdk", "sdk.js"),
        env,
        cwd: world.a.work,
      })
    case "tools":
      return createToolsDriver(await world.toolSession())
    case "cli":
      return createCliDriver({
        launcher: [process.execPath, world.install.omoJs],
        env: world.cliEnv,
        cwd: world.a.work,
      })
  }
}

// One step's bound: a surface that has not answered by then failed the step; its call is aborted (a driver that started
// a process stops it), and the surface's later cells are not reached, so no step runs beside a stalled one.
const STEP_DEADLINE_MS = 180_000
const withinStep = (
  run: (signal: AbortSignal) => Promise<Answer>,
  call: string,
): Promise<Answer & { stalled?: true }> => {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<Answer & { stalled: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ call, raw: { no_answer_within_ms: STEP_DEADLINE_MS }, answered: false, stalled: true })
    }, STEP_DEADLINE_MS)
  })
  return Promise.race([run(controller.signal), expired]).finally(() => clearTimeout(timer))
}

async function runSurface(surface: Surface, world: World): Promise<StepRecord[]> {
  const driver = await driverFor(surface, world)
  try {
    return await runSteps(surface, world, driver)
  } finally {
    await driver.close()
  }
}

async function runSteps(surface: Surface, world: World, driver: Driver): Promise<StepRecord[]> {
  const values: Record<string, string> = { deviceB: DEVICE_B.id, run: surface }
  const records: StepRecord[] = []
  let key: string | undefined
  // Set once this surface cannot go on (its open needs an account the world lacks, or a step stalled): every later cell
  // of the surface reads not reached with the same reason, never fail and never pass.
  let notRun: { readonly cell: Cell; readonly why: string } | undefined
  const record = (entry: StepRecord): void => {
    records.push(entry)
    process.stderr.write(`x1a ${surface} ${entry.step}: ${entry.cell} (${entry.why})\n`)
  }
  for (const step of SCENARIO) {
    const input = Object.fromEntries(Object.entries(step.input).map(([name, text]) => [name, fill(text, values)]))
    const mapping = driver.mapping[step.op]
    const skipped = (why: string, cell: Cell, slice: string): void =>
      record({ step: step.id, op: step.op, input, call: "-", raw: null, observed: null, cell, why, slice })
    if (mapping.kind === "unavailable") {
      skipped("no call on this surface today", "not reached", mapping.slice)
      continue
    }
    if (mapping.kind === "needs_account" && !world.account)
      notRun = {
        cell: "not reached",
        why: "the world carries no account",
      }
    if (notRun !== undefined) {
      skipped(notRun.why, notRun.cell, step.owner.slice)
      continue
    }
    // A step that names the thread cannot run when this surface's open answered none: it is not reached.
    if (step.op !== "create" && values["thread"] === undefined) {
      skipped("this surface's open answered no thread", "not reached", `${SCENARIO[0]?.owner.slice} (open)`)
      continue
    }
    const before = step.op === "create" ? await world.observer.keys() : new Set<string>()
    const setup = step.before === "fill-context" ? await world.observer.fill(key) : undefined
    if (setup !== undefined) {
      skipped(`world setup failed, not a product result: ${setup}`, "not reached", step.owner.slice)
      continue
    }
    const answer = await withinStep(
      (signal) =>
        driver.run({ op: step.op, input }, signal).catch((error: unknown) => ({
          call: mapping.how,
          raw: { thrown: String(error) },
          answered: false,
        })),
      mapping.how,
    )
    if ("stalled" in answer)
      notRun = {
        cell: "fail",
        why: "not reached: an earlier step of this surface did not answer within the step deadline",
      }
    if (step.op === "create") {
      key = await world.observer.adopt(before)
      if ("thread" in answer && typeof answer.thread === "string") values["thread"] = answer.thread
    }
    const turn = turnOf(answer.raw)
    if (turn !== undefined) values["turn"] = turn
    if (step.release !== undefined) world.fake.release(fill(step.release, values))
    const expect = JSON.parse(fill(JSON.stringify(step.expect), values))
    const refusal = step.refusedTo?.surfaces.includes(surface) === true ? step.refusedTo.code : undefined
    const verdict = await world.observer.judge(key, expect, answer.raw, answer.answered && refusal === undefined)
    const { cell, why } = cellOf(answer, verdict.ok ? undefined : verdict.why, refusal)
    record({
      step: step.id,
      op: step.op,
      input,
      call: answer.call,
      raw: answer.raw,
      observed: verdict.state,
      cell,
      why,
      slice: step.owner.slice,
    })
  }
  return records
}

async function main(): Promise<void> {
  const only = (arg("--only") ?? SURFACES.join(","))
    .split(",")
    .filter((s): s is Surface => SURFACES.some((x) => x === s))
  const evidence = resolve(
    arg("--evidence-dir") ??
      join(REPO, ".omo", "evidence", `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-sdk-proof-x1a`),
  )
  mkdirSync(evidence, { recursive: true })
  const world = await startWorld((line) => appendFileSync(join(evidence, "relay-trace.jsonl"), `${line}\n`))
  const sdkEntry = join(world.install.plugin, "runtime", "thread-sdk", "sdk.js")
  const build = `senpi ${world.engine}; thread SDK entry sha256 ${createHash("sha256").update(readFileSync(sdkEntry)).digest("hex").slice(0, 16)}`
  const redaction = { roots: world.roots, devices: { [DEVICE_A.id]: "<device-a>", [DEVICE_B.id]: "<device-b>" } }
  const runs: Record<Surface, StepRecord[]> = { sdk: [], tools: [], cli: [] }
  let isolation: Isolation = { refused: [], guarded: 0, sessionBus: false }
  try {
    // Fail closed before any surface runs: every write root of every environment the world uses stays in its scratch.
    const escaped = world.writeEnvs.flatMap(({ name, env, root }) =>
      outsideWriteRoots(env, [root]).map((entry) => `${name}: ${entry}`),
    )
    if (escaped.length > 0)
      throw new Error(`x1a world: a write root is outside the scratch directory: ${escaped.join("; ")}`)
    for (const surface of only) {
      runs[surface] = await runSurface(surface, world)
      writeFileSync(join(evidence, `${surface}.md`), redact(transcript(surface, build, runs[surface]), redaction))
    }
  } finally {
    isolation = world.isolation()
    await world.close()
  }
  const isolated = isolation.refused.length === 0 && !isolation.sessionBus
  writeFileSync(join(evidence, "isolation.json"), JSON.stringify(isolation, null, 2))
  writeFileSync(join(evidence, "relay-requests.json"), JSON.stringify(world.relay.requests, null, 2))
  const table = summary(build, SCENARIO, runs, [
    `Isolation: ${isolation.refused.length} request(s) to a non-loopback address refused; the loopback guard loaded in ${isolation.guarded} world processes; session bus in the world's environment: ${isolation.sessionBus ? "present" : "absent"}.`,
    "The table states what this world (real engine hosts, fake model, account and relay) shows; it claims nothing about production beyond it.",
  ])
  writeFileSync(join(evidence, "summary.md"), table)
  writeFileSync(join(import.meta.dir, "RESULTS.md"), table)
  // The synthetic credential must leave no trace: every evidence file and RESULTS.md is scanned for its canary.
  const leaked = [
    ...readdirSync(evidence).map((name) => join(evidence, name)),
    join(import.meta.dir, "RESULTS.md"),
  ].filter((path) => readFileSync(path, "utf8").includes(CANARY))
  if (leaked.length > 0) process.stderr.write(`x1a: the credential canary appears in ${leaked.join(", ")}\n`)
  process.stdout.write(`${table}\nevidence: ${evidence}\n`)
  if (!isolated || leaked.length > 0) process.exitCode = 1
}

if (import.meta.main) await main()
