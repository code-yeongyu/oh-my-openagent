#!/usr/bin/env bun
// The X1a proof (#14962): the scenario of scenario.ts run three times, each surface on its own, against one two-device
// world (world/world.ts), then the evidence: one transcript per surface (local, under --evidence-dir, default
// .omo/evidence/<date>-sdk-proof-x1a) and the summary table, rewritten in RESULTS.md beside this file.
//   bun run build:senpi-plugin
//   THREAD_QA_SENPI_VERSION=<the engine omo pins> bun script/qa/sdk-proof/run.ts [--evidence-dir <dir>] [--only sdk,tools,cli]
// A failing or unavailable cell is a finding: it names the slice that fixes it. Nothing here makes a cell pass.
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { createCliDriver } from "./drivers/cli.ts"
import { type Answer, type Driver, isRecord } from "./drivers/driver.ts"
import { createToolsDriver } from "./drivers/tools.ts"
import { type Cell, redact, type StepRecord, summary, type Surface, SURFACES, transcript } from "./evidence.ts"
import { fill, SCENARIO } from "./scenario.ts"
import { startSdkDriver } from "./world/sdk-process.ts"
import { DEVICE_A, DEVICE_B, startWorld, type World } from "./world/world.ts"

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
        launcher: [process.env["THREAD_QA_NODE"] ?? "node", world.install.omoJs],
        env,
        cwd: world.a.work,
      })
  }
}

// The failure a surface answered, as its code: the thread result's error code (inside --json for the CLI), else a
// thrown error, a step that never answered, or the raw shape.
const failureOf = (raw: unknown): string => {
  const body = isRecord(raw) && isRecord(raw["json"]) ? raw["json"] : raw
  if (isRecord(body) && isRecord(body["error"]) && typeof body["error"]["code"] === "string")
    return `error ${body["error"]["code"]}`
  if (isRecord(raw) && typeof raw["exit"] === "number" && raw["exit"] !== 0)
    return `exit ${raw["exit"]}: ${
      String(raw["stderr"] ?? "")
        .trim()
        .split("\n")[0] ?? ""
    }`
  if (isRecord(raw) && "thrown" in raw) return "a thrown error"
  if (isRecord(raw) && "no_answer_within_ms" in raw) return "nothing within the step deadline"
  return "no success result"
}

// One step's bound: a surface that has not answered by then failed the step, and the run goes on with the next.
const STEP_DEADLINE_MS = 180_000
const withinStep = <T extends Answer>(answer: Promise<T>, call: string): Promise<T | Answer> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<Answer>((resolve) => {
    timer = setTimeout(
      () => resolve({ call, raw: { no_answer_within_ms: STEP_DEADLINE_MS }, answered: false }),
      STEP_DEADLINE_MS,
    )
  })
  return Promise.race([answer, expired]).finally(() => clearTimeout(timer))
}

async function runSurface(surface: Surface, world: World): Promise<StepRecord[]> {
  const driver = await driverFor(surface, world)
  const values: Record<string, string> = { deviceB: DEVICE_B.id, run: surface }
  const records: StepRecord[] = []
  let key: string | undefined
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
      skipped("no call on this surface today", "n/a", mapping.slice)
      continue
    }
    // A step that names the thread cannot run when this surface's open answered none: it is not reached.
    if (step.op !== "create" && values["thread"] === undefined) {
      skipped("not reached: this surface's open answered no thread", "fail", `${SCENARIO[0]?.owner.slice} (open)`)
      continue
    }
    const before = step.op === "create" ? await world.observer.keys() : new Set<string>()
    const answer = await withinStep(
      driver.run({ op: step.op, input }).catch((error: unknown) => ({
        call: mapping.how,
        raw: { thrown: String(error) },
        answered: false,
      })),
      mapping.how,
    )
    if (step.op === "create") {
      key = await world.observer.adopt(before)
      if ("thread" in answer && typeof answer.thread === "string") values["thread"] = answer.thread
    }
    if (step.release !== undefined) world.fake.release(fill(step.release, values))
    const expect = JSON.parse(fill(JSON.stringify(step.expect), values))
    const verdict = await world.observer.judge(key, expect, answer.raw, answer.answered)
    const cell: Cell = answer.answered && verdict.ok ? "pass" : "fail"
    const why = !answer.answered ? `the surface answered ${failureOf(answer.raw)}` : verdict.why
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
  await driver.close()
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
  try {
    for (const surface of only) {
      runs[surface] = await runSurface(surface, world)
      writeFileSync(join(evidence, `${surface}.md`), redact(transcript(surface, build, runs[surface]), redaction))
    }
  } finally {
    await world.close()
  }
  writeFileSync(join(evidence, "relay-requests.json"), JSON.stringify(world.relay.requests, null, 2))
  const table = summary(build, SCENARIO, runs)
  writeFileSync(join(evidence, "summary.md"), table)
  writeFileSync(join(import.meta.dir, "RESULTS.md"), table)
  process.stdout.write(`${table}\nevidence: ${evidence}\n`)
}

if (import.meta.main) await main()
