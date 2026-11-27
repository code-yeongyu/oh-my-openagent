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
import { type Driver, isRecord } from "./drivers/driver.ts"
import { createToolsDriver } from "./drivers/tools.ts"
import { redact, type StepRecord, summary, type Surface, SURFACES, transcript } from "./evidence.ts"
import { type KeyedRecord, keyedTable, openKeyedThread, runKeyedPairs } from "./keyed.ts"
import { SCENARIO } from "./scenario.ts"
import { prepared, runSteps, STEP_DEADLINE_MS, unprepared } from "./steps.ts"
import { startSdkDriver } from "./world/sdk-process.ts"
import { DEVICE_A, DEVICE_B } from "./world/devices.ts"
import { CANARY, type Isolation, startWorld, stopWorldChildren, type World } from "./world/world.ts"

// Building the install and starting both engine hosts takes minutes on a loaded host.
const WORLD_DEADLINE_MS = 900_000

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

async function runSurface(surface: Surface, world: World): Promise<StepRecord[]> {
  // The surface's preparation (its driver; for the tools a session on A) is bounded like a step.
  const driver = await prepared(driverFor(surface, world), STEP_DEADLINE_MS, (late) => void late.close())
  if (driver === undefined) return unprepared(surface, `the ${surface} surface's preparation`)
  try {
    return await runSteps(surface, world, driver)
  } finally {
    await driver.close()
  }
}

// The keyed pairs share one thread on B, opened through the CLI (the surface whose open delivers its first prompt today).
// Stands in for a driver that never became ready: no pair runs, so it is never called.
const STALLED: Driver = {
  mapping: {} as Driver["mapping"],
  run: async () => ({ call: "-", raw: null, answered: false }),
  close: async () => {},
}

async function runKeyed(world: World): Promise<KeyedRecord[]> {
  const all = Promise.all(SURFACES.map(async (surface) => [surface, await driverFor(surface, world)] as const))
  const ready = await prepared(
    all,
    STEP_DEADLINE_MS,
    (late) => void Promise.all(late.map(([, driver]) => driver.close())),
  )
  if (ready === undefined)
    return runKeyedPairs(
      { sdk: STALLED, tools: STALLED, cli: STALLED },
      undefined,
      undefined,
      world.observer,
      undefined,
      "the keyed pairs' drivers were not ready within the step deadline (the harness: no answer to attribute)",
    )
  const drivers = Object.fromEntries(ready) as Record<Surface, Driver>
  try {
    const opened = await openKeyedThread(drivers.cli, DEVICE_B.id, world.observer)
    return await runKeyedPairs(
      drivers,
      opened.thread,
      opened.key,
      world.observer,
      undefined,
      opened.stalled
        ? "the thread for the pairs did not open within the step deadline (the harness: no answer to attribute)"
        : undefined,
    )
  } finally {
    await Promise.all(SURFACES.map((surface) => drivers[surface].close()))
  }
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
  // The world's start (install, engine hosts, A's daemon) is bounded too: a stall ends the run, its children stopped.
  const world = await prepared(
    startWorld((line) => appendFileSync(join(evidence, "relay-trace.jsonl"), `${line}\n`)),
    WORLD_DEADLINE_MS,
    (late) => void late.close(),
  )
  if (world === undefined) {
    await stopWorldChildren()
    throw new Error(`x1a world: the two-device world did not start within ${WORLD_DEADLINE_MS} ms (the harness)`)
  }
  const sdkEntry = join(world.install.plugin, "runtime", "thread-sdk", "sdk.js")
  const build = `senpi ${world.engine}; thread SDK entry sha256 ${createHash("sha256").update(readFileSync(sdkEntry)).digest("hex").slice(0, 16)}`
  const redaction = { roots: world.roots, devices: { [DEVICE_A.id]: "<device-a>", [DEVICE_B.id]: "<device-b>" } }
  const runs: Record<Surface, StepRecord[]> = { sdk: [], tools: [], cli: [] }
  let isolation: Isolation = { refused: [], guarded: 0, sessionBus: false }
  let keyed: KeyedRecord[] = []
  try {
    for (const surface of only) {
      runs[surface] = await runSurface(surface, world)
      writeFileSync(join(evidence, `${surface}.md`), redact(transcript(surface, build, runs[surface]), redaction))
    }
    if (only.length === SURFACES.length) {
      keyed = await runKeyed(world)
      writeFileSync(join(evidence, "keyed.json"), redact(JSON.stringify(keyed, null, 2), redaction))
    }
  } finally {
    isolation = world.isolation()
    await world.close()
  }
  const torn = world.teardown()
  const tornDown = torn.rootsLeft.length === 0 && torn.processesLeft === 0 && torn.processProbe === "read"
  const isolated = isolation.refused.length === 0 && !isolation.sessionBus
  writeFileSync(
    join(evidence, "isolation.json"),
    JSON.stringify({ ...isolation, teardown: { ...torn, rootsLeft: torn.rootsLeft.length } }, null, 2),
  )
  writeFileSync(join(evidence, "relay-requests.json"), JSON.stringify(world.relay.requests, null, 2))
  // What the fake model was asked and how it answered, in order: the answer kind and the hold tag, never the bodies.
  writeFileSync(
    join(evidence, "model-requests.json"),
    JSON.stringify(
      world.fake.requests.map((request) => {
        const answer = isRecord(request) && isRecord(request["answer"]) ? request["answer"] : {}
        return {
          kind: answer["kind"] ?? null,
          tag: answer["tag"] ?? answer["hold"] ?? null,
          tool: answer["tool"] ?? null,
        }
      }),
      null,
      2,
    ),
  )
  const table = summary(build, SCENARIO, runs, [
    `Isolation: ${isolation.refused.length} request(s) to a non-loopback address refused; the loopback guard loaded in ${isolation.guarded} world processes; session bus in the world's environment: ${isolation.sessionBus ? "present" : "absent"}.`,
    `Teardown, read back after the world closed: ${torn.roots - torn.rootsLeft.length} of ${torn.roots} scratch roots gone; ${torn.processProbe === "read" ? `${torn.processesLeft} process(es) still naming one` : "the process table could not be read (the check fails)"}.`,
    "Attribution: a fail cell is the product's only on the surface's own answer (its error code, or its success while device B, read through B's own engine, shows otherwise); a stall is the harness's; a world-setup failure is not reached. Each observation is tied to its call: B's thread by the id its open adopted, a tool result by a nonce in that step's prompt, an SDK result by its request id, a CLI result by its own process.",
    "The table states what this world (real engine hosts, fake model, account and relay) shows; it claims nothing about production beyond it.",
  ])
  const results = keyed.length === 0 ? table : `${table}${keyedTable(keyed)}`
  writeFileSync(join(evidence, "summary.md"), results)
  writeFileSync(join(import.meta.dir, "RESULTS.md"), results)
  // The synthetic credential must leave no trace: every evidence file and RESULTS.md is scanned for its canary.
  const leaked = [
    ...readdirSync(evidence).map((name) => join(evidence, name)),
    join(import.meta.dir, "RESULTS.md"),
  ].filter((path) => readFileSync(path, "utf8").includes(CANARY))
  if (leaked.length > 0) process.stderr.write(`x1a: the credential canary appears in ${leaked.join(", ")}\n`)
  process.stdout.write(`${results}\nevidence: ${evidence}\n`)
  if (!isolated || leaked.length > 0 || !tornDown) process.exitCode = 1
}

if (import.meta.main) await main()
