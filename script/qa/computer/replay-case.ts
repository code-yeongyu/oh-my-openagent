// The corpus case format replay.ts drives: a case file parsed into its transport, scenario, env,
// planted runtime state and steps; the `*.json` cases of a directory; the old cases a case
// supersedes; and whether ORACLE-PROVENANCE.tsv lists a case as an imported oracle case.
import { constants } from "node:fs"
import { access, chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export const ROOT = resolve(import.meta.dir, "../../..")
const PROVENANCE = join(ROOT, "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv")
// R70bj: the scenario an imported (pinned) case is replayed with, so its bytes never change;
// row 28 retires this table with the explicit-stop-key fixture copies.
const SCENARIO_OVERRIDES = join(ROOT, "crates/omo-computer-core/fixtures/conformance/v3-scenario-overrides.tsv")
export const TRANSPORT_ARGS = { stdio: ["--stdio"], mcp: ["--mcp"], oneshot: ["--oneshot"] } as const

type Transport = keyof typeof TRANSPORT_ARGS
type Expectation = { readonly message: unknown; readonly variable: readonly string[] }
type Step =
  | { readonly restart: true }
  | {
      readonly restart: false
      readonly send: unknown
      readonly expect: readonly Expectation[]
      readonly sink: number | undefined
    }
type Plant = {
  readonly path: string
  readonly dir: boolean
  readonly content: string | undefined
  readonly mode: number | undefined
}
type Case = {
  readonly transport: Transport
  readonly scenario: string | undefined
  readonly env: Readonly<Record<string, string>>
  readonly plant: readonly Plant[]
  readonly steps: readonly Step[]
}

export class InputError extends Error {}
class TransportMissing extends InputError {
  constructor(name: string) {
    super(
      `transport_missing: ${name} names no transport and ORACLE-PROVENANCE.tsv does not list it as an imported oracle case`,
    )
  }
}

export const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function readText(file: string, what: string): Promise<string> {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    throw new InputError(`cannot read the ${what} ${file}: ${describe(error)}`)
  }
}

export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new InputError(`the ${what} is not JSON: ${describe(error)}`)
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isTransport = (value: unknown): value is Transport => typeof value === "string" && value in TRANSPORT_ARGS
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

function parseStep(raw: unknown, index: number): Step {
  if (!isRecord(raw)) throw new InputError(`step ${index + 1} is not an object`)
  if (raw.restart === true) return { restart: true }
  const { send, expect, sink } = raw
  if (!isRecord(send) || !Array.isArray(expect)) throw new InputError(`step ${index + 1} needs send and expect[]`)
  if (sink !== undefined && !(Number.isInteger(sink) && typeof sink === "number" && sink >= 0))
    throw new InputError(`step ${index + 1}: sink must be a count`)
  const expectations = expect.map((item: unknown): Expectation => {
    if (!isRecord(item) || !("message" in item)) throw new InputError(`step ${index + 1}: an expectation needs message`)
    const variable = item.variable ?? []
    if (!isStrings(variable)) throw new InputError(`step ${index + 1}: variable must be pointers`)
    return { message: item.message, variable }
  })
  return { restart: false, send, expect: expectations, sink }
}

function parsePlant(runtime: unknown): Plant[] {
  if (runtime === undefined) return []
  if (!isRecord(runtime) || !Array.isArray(runtime.plant)) throw new InputError("runtime must be { plant: [...] }")
  return runtime.plant.map((item: unknown, index): Plant => {
    const at = `runtime.plant[${index}]`
    if (!isRecord(item) || typeof item.path !== "string") throw new InputError(`${at} needs a path`)
    const path = item.path
    if (path === "" || isAbsolute(path) || path.split("/").includes(".."))
      throw new InputError(`${at}.path must stay inside the runtime dir`)
    const dir = item.dir === true
    const content = typeof item.content === "string" ? item.content : undefined
    if (dir === (content !== undefined)) throw new InputError(`${at} needs either content or dir: true`)
    const { mode } = item
    if (mode !== undefined && !(typeof mode === "string" && /^0?[0-7]{3}$/.test(mode)))
      throw new InputError(`${at}.mode must be an octal string such as "0600"`)
    return { path, dir, content, mode: mode === undefined ? undefined : Number.parseInt(mode, 8) }
  })
}

// Plants a case's starting state under `runtime`; answers the directories whose mode it narrowed.
export async function plantIn(runtime: string, items: readonly Plant[]): Promise<string[]> {
  for (const item of items) {
    const target = join(runtime, item.path)
    if (item.dir) {
      await mkdir(target, { recursive: true, mode: 0o700 })
      continue
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, item.content ?? "")
    await chmod(target, item.mode ?? 0o600)
  }
  const narrowed: string[] = []
  for (const item of items) {
    if (!item.dir || item.mode === undefined) continue
    const target = join(runtime, item.path)
    await chmod(target, item.mode)
    narrowed.push(target)
  }
  return narrowed
}

export function parseCase(raw: unknown, name: string, imported: boolean): Case {
  if (!isRecord(raw)) throw new InputError("the case is not an object")
  const { scenario, env = {}, steps } = raw
  if (raw.transport === undefined && !imported) throw new TransportMissing(name)
  const transport = raw.transport ?? "stdio"
  if (!isTransport(transport)) throw new InputError(`unknown transport ${JSON.stringify(transport)}`)
  if (scenario !== undefined && typeof scenario !== "string") throw new InputError("scenario must be a path")
  if (!isRecord(env) || !Object.values(env).every((value) => typeof value === "string"))
    throw new InputError("env must map names to strings")
  if (!Array.isArray(steps)) throw new InputError("steps must be an array")
  return {
    transport,
    scenario,
    env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])),
    plant: parsePlant(raw.runtime),
    steps: steps.map(parseStep),
  }
}

export async function isImported(casePath: string): Promise<boolean> {
  const rows = (await readText(PROVENANCE, "provenance manifest")).trim().split("\n").slice(1)
  return rows.some((row) => resolve(ROOT, row.split("\t")[0] ?? "") === casePath)
}

// Every `*.json` file of `dir`, in name order.
export async function casesIn(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch((error: unknown) => {
    throw new InputError(`cannot read the case directory ${dir}: ${describe(error)}`)
  })
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name))
}

type Superseded = { readonly old: string; readonly by: string }

// The old cases the listed cases supersede, keyed by path; a named file that does not exist is an input error.
export async function supersededBy(listed: readonly string[]): Promise<Map<string, Superseded>> {
  const skips = new Map<string, Superseded>()
  for (const casePath of listed) {
    const raw = parseJson(await readText(casePath, "case file"), "case file")
    if (!isRecord(raw) || raw.supersedes === undefined) continue
    if (!isStrings(raw.supersedes)) throw new InputError(`${basename(casePath)}: supersedes must list case file names`)
    for (const old of raw.supersedes) {
      const oldPath = resolve(dirname(casePath), old)
      const exists = await access(oldPath, constants.R_OK).then(
        () => true,
        () => false,
      )
      if (!exists) throw new InputError(`supersedes_missing: ${basename(casePath)} names ${old}, which does not exist`)
      skips.set(oldPath, { old, by: basename(casePath) })
    }
  }
  return skips
}

/** The scenario SCENARIO-OVERRIDES.tsv names for the case file `casePath`, if any (R70bj). */
export async function scenarioOverride(casePath: string, table = SCENARIO_OVERRIDES): Promise<string | undefined> {
  const text = await readFile(table, "utf8").catch(() => "")
  const name = basename(casePath)
  for (const line of text.split("\n").slice(1)) {
    const [file, scenario] = line.split("\t")
    if (file === name && scenario) return scenario
  }
  return undefined
}
