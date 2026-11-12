import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { catalogFor, SESSIONS } from "../catalog.ts"
import { type Action, OS_NAMES, type Oracle } from "../vocabulary.ts"
import { FixtureProcess } from "./fixture-process.ts"

type Field = Oracle["field"]
type Leg = { readonly name: string; readonly fields: readonly string[]; readonly run: (dir: string) => Promise<string> }

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

function legs(command: readonly string[], sabotage: string): Leg[] {
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
  const savedFields = ["title", "savedDocuments"]
  return [
    ...actionLegs,
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
  ]
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { fixture: { type: "string" }, sabotage: { type: "string", default: "" } },
  })
  const name = values.fixture
  if (name === undefined || positionals.length === 0) {
    console.error("usage: self-test.ts --fixture <name> [--sabotage <field>] -- <fixture command...>")
    return 2
  }
  const sabotage = values.sabotage
  const root = mkdtempSync(join(tmpdir(), `fixture-self-test-${name}-`))
  const failed: Leg[] = []
  let passed = 0
  try {
    for (const leg of legs(positionals, sabotage)) {
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
