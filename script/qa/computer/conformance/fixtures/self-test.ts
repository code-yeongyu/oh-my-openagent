import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { catalogFor, SESSIONS } from "../catalog.ts"
import { type Action, OS_NAMES, type Oracle } from "../vocabulary.ts"
import { FixtureProcess } from "./fixture-process.ts"
import { fixtureDataEntries, leftoversSince } from "./hermetic-check.ts"

type Field = Oracle["field"]
const MAIN_WINDOW = "Conformance Document"
type Leg = { readonly name: string; readonly fields: readonly string[]; readonly run: (dir: string) => Promise<string> }

async function runA11yProbe(probe: string, pid: number): Promise<void> {
  const child = Bun.spawn(["bash", "-c", probe.replaceAll("{pid}", String(pid))], {
    stdout: "pipe",
    stderr: "inherit",
  })
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  const last = output.trim().split("\n").at(-1) ?? ""
  if (code !== 0) {
    throw new Error(
      code === 3
        ? `ENVIRONMENT: the a11y probe could not reach the accessibility tree: ${last}`
        : `the accessibility tree hides the page's controls (probe exit ${code}): ${last}`,
    )
  }
}

function catalogOracles(): { effect: ReadonlyMap<Action, Oracle>; initial: ReadonlyMap<Field, Oracle["equals"]> } {
  const effect = new Map<Action, Oracle>()
  const initial = new Map<Field, Oracle["equals"]>()
  for (const cell of OS_NAMES.flatMap((os) => catalogFor(os, SESSIONS[os]))) {
    if ("deliver" in cell.expect) effect.set(cell.action, cell.oracle)
    else initial.set(cell.oracle.field, cell.oracle.equals)
  }
  const missingField = [...effect.values()].find((oracle) => !initial.has(oracle.field))
  if (missingField !== undefined) throw new Error(`the catalog has no refusal value for field ${missingField.field}`)
  return { effect, initial }
}

function differences(expected: Readonly<Record<string, unknown>>, actual: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(expected)
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}=${JSON.stringify(actual[key])} expected ${JSON.stringify(expected[key])}`)
}

function check(problems: readonly string[], what: string): void {
  if (problems.length > 0) throw new Error(`${what}: ${problems.join("; ")}`)
}

async function withFixture(
  command: readonly string[],
  sabotage: string,
  dir: string,
  body: (fixture: FixtureProcess) => Promise<void>,
): Promise<string> {
  const fixture = await FixtureProcess.start(command, join(dir, "report.json"), sabotage)
  try {
    await body(fixture)
    return fixture.reportText()
  } finally {
    await fixture.stop()
  }
}

function legs(
  command: readonly string[],
  sabotage: string,
  appKey: string,
  a11yProbe: string | undefined,
  baseline: ReadonlySet<string>,
): Leg[] {
  const { effect, initial } = catalogOracles()
  const untouched: Record<string, unknown> = Object.fromEntries(initial)
  const actionLegs = [...effect].map(([action, oracle]): Leg => ({
    name: `action:${action}`,
    fields: [oracle.field],
    run: (dir) =>
      withFixture(command, sabotage, dir, async (fixture) => {
        check(differences(untouched, fixture.report().fields), "before the poke")
        await fixture.send(`poke ${action}`)
        check(differences({ ...untouched, [oracle.field]: oracle.equals }, fixture.report().fields), "after the poke")
      }),
  }))
  const saveDocument = (dir: string) =>
    withFixture(command, sabotage, dir, async (fixture) => {
      await fixture.send("set Title Quarterly plan")
      check(differences({ title: "", savedDocuments: 0 }, fixture.report().saved), "before File > Save")
      await fixture.send("menu File/Save")
      check(differences({ title: "Quarterly plan", savedDocuments: 1 }, fixture.report().saved), "after File > Save")
    })
  const titles = (expected: readonly string[], seen: readonly string[], when: string) => {
    if (JSON.stringify(seen) !== JSON.stringify(expected))
      throw new Error(`${when}: windows ${JSON.stringify(seen)} expected ${JSON.stringify(expected)}`)
  }
  const windowTitles: Leg = {
    name: "windows:titles-and-app-key",
    fields: [],
    run: (dir) =>
      withFixture(command, sabotage, dir, async (fixture) => {
        titles([MAIN_WINDOW], fixture.report().windows, "at start")
        const reported = fixture.report().appKey
        if (reported !== appKey) throw new Error(`appKey ${JSON.stringify(reported)} expected ${JSON.stringify(appKey)}`)
        await fixture.send("menu File/New Window")
        titles([MAIN_WINDOW, `${MAIN_WINDOW} 2`], fixture.report().windows, "after File > New Window")
      }),
  }
  const savedFields = ["title", "savedDocuments"]
  // The a11y leg proves the page's controls are visible to the OS accessibility tree. Its sabotage target
  // "a11y" makes the page hide itself from assistive technology (aria-hidden on body), so the probe must go red.
  // The hermetic leg (web-hosting fixtures, the ones given --a11y) runs last and fails when any leg of this run left
  // fixture or Electron data in a user profile or temp location, counted against the baseline main() takes before
  // the first leg, so a fixed-name folder every run rewrites is caught too.
  const webHosted = a11yProbe !== undefined
  const a11y: Leg[] =
    a11yProbe === undefined || (sabotage !== "" && sabotage !== "a11y")
      ? []
      : [
          {
            name: "a11y:controls-visible",
            fields: ["a11y"],
            run: (dir) =>
              withFixture(command, sabotage, dir, async (fixture) => {
                await runA11yProbe(a11yProbe, fixture.pid)
              }),
          },
        ]
  const hermetic: Leg[] =
    !webHosted || sabotage !== ""
      ? []
      : [
          {
            name: "hermetic:no-profile-data-left",
            fields: [],
            run: async (dir) => {
              const text = await withFixture(command, sabotage, dir, async () => {})
              check(
                leftoversSince(baseline).map((entry) => `left ${entry}`),
                "after every leg's fixture exited",
              )
              return text
            },
          },
        ]
  return [
    ...actionLegs,
    ...a11y,
    windowTitles,
    { name: "document:save", fields: savedFields, run: saveDocument },
    {
      name: "deterministic",
      fields: savedFields,
      run: async (dir) => {
        const first = await saveDocument(join(dir, "first"))
        const second = await saveDocument(join(dir, "second"))
        if (first !== second) throw new Error("two identical runs wrote different reports")
        return second
      },
    },
    ...hermetic,
  ]
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      fixture: { type: "string" },
      "app-key": { type: "string" },
      sabotage: { type: "string", default: "" },
      a11y: { type: "string" },
    },
  })
  const name = values.fixture
  const appKey = values["app-key"]
  if (name === undefined || appKey === undefined || positionals.length === 0) {
    console.error(
      "usage: self-test.ts --fixture <name> --app-key <key> [--sabotage <field>] [--a11y <probe command with {pid}>] -- <fixture command...>",
    )
    return 2
  }
  const sabotage = values.sabotage
  const a11yProbe = values.a11y
  const root = mkdtempSync(join(tmpdir(), `fixture-self-test-${name}-`))
  const baseline = fixtureDataEntries()
  const failed: Leg[] = []
  let passed = 0
  try {
    for (const leg of legs(positionals, sabotage, appKey, a11yProbe, baseline)) {
      const dir = join(root, leg.name.replace(/[^a-zA-Z0-9.-]/g, "_"))
      try {
        for (const sub of ["first", "second"]) mkdirSync(join(dir, sub), { recursive: true })
        await leg.run(dir)
        passed += 1
        console.log(`CHECK ${name} ${leg.name} pass`)
      } catch (error) {
        failed.push(leg)
        console.log(`CHECK ${name} ${leg.name} FAIL ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  if (sabotage === "") {
    console.log(`SELFTEST ${name} pass=${passed} fail=${failed.length}`)
    return failed.length === 0 ? 0 : 1
  }
  const stray = failed.filter((leg) => !leg.fields.includes(sabotage))
  if (failed.length === 0 || stray.length > 0) {
    const why = failed.length === 0 ? "STAYED GREEN" : `went red elsewhere: ${stray.map((leg) => leg.name).join(",")}`
    console.log(`SABOTAGE ${name} ${sabotage} ${why}`)
    return 1
  }
  console.log(`SABOTAGE ${name} ${sabotage} red=${failed.length}`)
  return 0
}

process.exit(await main())
