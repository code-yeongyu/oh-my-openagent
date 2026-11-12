#!/usr/bin/env bun
// Replays one corpus case against an engine binary the way a consumer drives it.
//
//   bun script/qa/computer/replay.ts --engine <binary> --case <file> [--case <file> ...] [--dir <dir> ...]
//                                    [--assert-sink-empty] [--deltas <tsv>]
//
// Every reply is deep-compared with the case's expected messages modulo the case's `variable`
// JSON pointers and the lines of ORACLE-DELTAS.tsv (row 3's rule: an `additive` line accepts an
// extra member only where its pattern matches, a member the expectation lists is always compared
// exactly, and a `replaced` line moves the expected value at its pointer to its v3 value).
// Prints `REPLAY_OK <case> steps=<n>` or one line per mismatch and exits 1; then the teardown
// receipts `procs <n>` and `dir REMOVED <path>`. Only a reply mismatch exits 1: every input or
// setup error (arguments, an unreadable or malformed case or delta file, an engine that cannot
// be spawned) prints `REPLAY_ERROR <why>` and exits 2. A case with no `transport` is replayed
// over stdio only when ORACLE-PROVENANCE.tsv lists it as an imported oracle case (the v1 corpus
// predates the field); any other case without one is refused `REPLAY_ERROR transport_missing`.
// Several `--case` files, or every `*.json` case of a `--dir`, replay as one list, in order. A case
// may carry `"supersedes": [<old case file name>, ...]` (names resolved beside the case): every named
// file must exist, else `REPLAY_ERROR supersedes_missing` (exit 2, nothing replayed), and an old case
// in the list is not replayed but prints `SKIPPED <old> superseded by <new>`. The superseding case
// itself always replays, and the list exits with the worst code of the cases it replayed.
// Every case runs in a fresh temporary runtime dir (OMO_COMPUTER_RUNTIME_DIR) that is removed
// afterwards, so no case sees another's leftovers. `${RUNTIME_DIR}` in a case's env values is
// replaced with that dir, and a case may plant its starting state there before the engine starts:
// `"runtime": {"plant": [{"path": <relative>, "content": <text>, "mode": "0600"} |
// {"path": <relative>, "dir": true, "mode": "0500"}]}` (files default to 0600, parents are 0700,
// directory modes are applied after every file).
import { constants } from "node:fs"
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../../..")
const DEFAULT_DELTAS = join(ROOT, "crates/omo-computer-core/parity/ORACLE-DELTAS.tsv")
const PROVENANCE = join(ROOT, "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv")
const SINK_PREFIX = "fake-sink-" // the engine's per-process sink file under OMO_COMPUTER_RUNTIME_DIR
const MESSAGE_TIMEOUT_MS = 10_000
const EXIT_TIMEOUT_MS = 5_000
const RUNTIME_PLACEHOLDER = "$" + "{RUNTIME_DIR}"
const TRANSPORT_ARGS = { stdio: ["--stdio"], mcp: ["--mcp"], oneshot: ["--oneshot"] } as const

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
type Delta = {
  readonly kind: string
  readonly pointer: string
  readonly pattern: readonly string[]
  readonly imported: unknown
  readonly v3: unknown
  matched: number
}

class InputError extends Error {}
class TransportMissing extends InputError {
  constructor(name: string) {
    super(
      `transport_missing: ${name} names no transport and ORACLE-PROVENANCE.tsv does not list it as an imported oracle case`,
    )
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function readText(file: string, what: string): Promise<string> {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    throw new InputError(`cannot read the ${what} ${file}: ${describe(error)}`)
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new InputError(`the ${what} is not JSON: ${describe(error)}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
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
async function plantIn(runtime: string, items: readonly Plant[]): Promise<string[]> {
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

function parseCase(raw: unknown, name: string, imported: boolean): Case {
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

const segments = (pointer: string): string[] =>
  pointer
    .split("/")
    .slice(1)
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"))
const child = (pointer: string, key: string) => `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`

function matches(pattern: readonly string[], pointer: string): boolean {
  const path = segments(pointer)
  const fits = (pat: readonly string[], segs: readonly string[]) =>
    pat.length === segs.length && pat.every((seg, i) => seg === "*" || seg === segs[i])
  if (pattern[0] === "**")
    return path.length >= pattern.length - 1 && fits(pattern.slice(1), path.slice(path.length - pattern.length + 1))
  return fits(pattern, path)
}

async function isImported(casePath: string): Promise<boolean> {
  const rows = (await readText(PROVENANCE, "provenance manifest")).trim().split("\n").slice(1)
  return rows.some((row) => resolve(ROOT, row.split("\t")[0] ?? "") === casePath)
}

async function loadDeltas(file: string, casePath: string): Promise<Delta[]> {
  const rows = (await readText(file, "delta file"))
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "")
  return rows.flatMap((line) => {
    const [target = "", pointer = "", kind = "", , , imported = "", v3 = ""] = line.split("\t")
    if (target !== "*" && resolve(ROOT, target) !== casePath) return []
    if (kind !== "additive" && kind !== "replaced") return []
    const pattern = (pointer.startsWith("/") ? pointer.slice(1) : pointer).split("/")
    const value = (text: string) => (kind === "replaced" ? parseJson(text, `replaced value of ${pointer}`) : undefined)
    return [{ kind, pointer, pattern, imported: value(imported), v3: value(v3), matched: 0 }]
  })
}

type Context = {
  readonly variable: ReadonlySet<string>
  readonly deltas: readonly Delta[]
  readonly fail: (pointer: string, detail: string) => void
}
const show = (value: unknown) => JSON.stringify(value)

function compare(expectedRaw: unknown, actual: unknown, pointer: string, ctx: Context): void {
  if (ctx.variable.has(pointer)) return
  const replaced = ctx.deltas.find(
    (d) => d.kind === "replaced" && matches(d.pattern, pointer) && Bun.deepEquals(d.imported, expectedRaw, true),
  )
  if (replaced) replaced.matched += 1
  const expected = replaced ? replaced.v3 : expectedRaw
  if (actual === undefined) return ctx.fail(pointer, `missing, expected ${show(expected)}`)
  if (isRecord(expected) && isRecord(actual)) {
    for (const key of Object.keys(expected)) compare(expected[key], actual[key], child(pointer, key), ctx)
    for (const key of Object.keys(actual).filter((k) => !(k in expected))) {
      const at = child(pointer, key)
      if (ctx.variable.has(at)) continue
      const additive = ctx.deltas.find((d) => d.kind === "additive" && matches(d.pattern, at))
      if (additive) additive.matched += 1
      else ctx.fail(at, `unexpected member ${show(actual[key])} (no ORACLE-DELTAS line matches it)`)
    }
    return
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length)
      return ctx.fail(pointer, `expected ${expected.length} items, got ${actual.length}`)
    expected.forEach((item, i) => compare(item, actual[i], child(pointer, String(i)), ctx))
    return
  }
  if (!Bun.deepEquals(expected, actual, true)) ctx.fail(pointer, `expected ${show(expected)} got ${show(actual)}`)
}

class Peer {
  readonly proc: Bun.Subprocess<"pipe", "pipe", "inherit">
  private readonly queue: unknown[] = []
  private readonly waiters: Array<(message: unknown) => void> = []
  private ended = false
  private readonly pumped: Promise<void>

  constructor(cmd: string[], env: Record<string, string>) {
    try {
      this.proc = Bun.spawn(cmd, { cwd: ROOT, env, stdin: "pipe", stdout: "pipe", stderr: "inherit" })
    } catch (error) {
      throw new InputError(`cannot spawn the engine ${cmd[0]}: ${describe(error)}`)
    }
    this.pumped = this.pump()
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of this.proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        this.push(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
      }
    }
    this.push(buffer)
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter(undefined)
  }

  private push(line: string): void {
    if (line.trim() === "") return
    let message: unknown = line
    try {
      message = JSON.parse(line)
    } catch {
      /* an unparsable line stays a string and mismatches */
    }
    const waiter = this.waiters.shift()
    if (waiter) waiter(message)
    else this.queue.push(message)
  }

  send(message: unknown): void {
    try {
      this.proc.stdin.write(`${JSON.stringify(message)}\n`)
      this.proc.stdin.flush()
    } catch {
      /* the engine is gone: its missing replies are reported as mismatches */
    }
  }

  next(): Promise<unknown> {
    if (this.queue.length > 0 || this.ended) return Promise.resolve(this.queue.shift())
    return new Promise((done) => {
      const waiter = (message: unknown) => {
        clearTimeout(timer)
        done(message)
      }
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        done(undefined)
      }, MESSAGE_TIMEOUT_MS)
      this.waiters.push(waiter)
    })
  }

  async close(): Promise<unknown[]> {
    this.proc.stdin.end()
    let timer: Timer | undefined
    const deadline = new Promise<false>((done) => {
      timer = setTimeout(() => done(false), EXIT_TIMEOUT_MS)
    })
    const exited = await Promise.race([this.proc.exited.then(() => true), deadline])
    clearTimeout(timer)
    if (!exited) this.proc.kill("SIGKILL")
    await this.proc.exited
    await this.pumped
    return this.queue.splice(0)
  }
}

async function sinkCount(dir: string): Promise<number> {
  const files = (await readdir(dir)).filter((name) => name.startsWith(SINK_PREFIX))
  const texts = await Promise.all(files.map((name) => readFile(join(dir, name), "utf8")))
  return texts.reduce((sum, text) => sum + text.split("\n").filter((line) => line.trim() !== "").length, 0)
}

type Options = {
  readonly engine: string
  readonly cases: readonly string[]
  readonly dirs: readonly string[]
  readonly deltas: string
  readonly assertSinkEmpty: boolean
}

function args(argv: readonly string[]): Options {
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const values = (flag: string) =>
    argv.flatMap((arg, i) => (arg === flag && argv[i + 1] !== undefined ? [argv[i + 1] ?? ""] : []))
  const engine = value("--engine")
  const cases = values("--case")
  const dirs = values("--dir")
  if (!engine || (cases.length === 0 && dirs.length === 0))
    throw new InputError(
      "usage: replay.ts --engine <binary> --case <file> [--case <file> ...] [--dir <dir> ...] [--assert-sink-empty] [--deltas <tsv>]",
    )
  return {
    engine: resolve(engine),
    cases: cases.map((file) => resolve(file)),
    dirs: dirs.map((dir) => resolve(dir)),
    deltas: resolve(value("--deltas") ?? DEFAULT_DELTAS),
    assertSinkEmpty: argv.includes("--assert-sink-empty"),
  }
}

// Every `*.json` file of `dir`, in name order.
async function casesIn(dir: string): Promise<string[]> {
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
async function supersededBy(listed: readonly string[]): Promise<Map<string, Superseded>> {
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

async function replay(argv: readonly string[]): Promise<number> {
  const opts = args(argv)
  const listed = [...opts.cases, ...(await Promise.all(opts.dirs.map(casesIn))).flat()]
  const skips = await supersededBy(listed)
  const only = listed[0]
  if (listed.length === 1 && opts.dirs.length === 0 && only !== undefined) return replayCase(opts, only)
  let code = 0
  for (const casePath of listed) {
    const skip = skips.get(casePath)
    if (skip) {
      console.log(`SKIPPED ${skip.old} superseded by ${skip.by}`)
      continue
    }
    try {
      code = Math.max(code, await replayCase(opts, casePath))
    } catch (error) {
      console.log(`REPLAY_ERROR ${describe(error)}`)
      code = 2
    }
  }
  return code
}

async function replayCase(opts: Options, casePath: string): Promise<number> {
  const rel = relative(ROOT, casePath)
  const name = rel.startsWith("..") ? casePath : rel
  const spec = parseCase(
    parseJson(await readText(casePath, "case file"), "case file"),
    name,
    await isImported(casePath),
  )
  await access(opts.engine, constants.X_OK).catch((error: unknown) => {
    throw new InputError(`the engine ${opts.engine} is not an executable file: ${describe(error)}`)
  })
  const deltas = await loadDeltas(opts.deltas, casePath)
  const runtime = await mkdtemp(join(tmpdir(), "omo-replay-"))
  const failures: string[] = []
  const peers: Peer[] = []
  const inherited = Object.entries(process.env).filter(
    (e): e is [string, string] => !e[0].startsWith("OMO_COMPUTER_") && e[1] !== undefined,
  )
  const env: Record<string, string> = {
    ...Object.fromEntries(inherited),
    OMO_COMPUTER_BACKEND: "fake",
    OMO_COMPUTER_RUNTIME_DIR: runtime,
    ...Object.fromEntries(Object.entries(spec.env).map(([k, v]) => [k, v.replaceAll(RUNTIME_PLACEHOLDER, runtime)])),
  }
  if (spec.scenario) env.OMO_COMPUTER_FAKE_SCENARIO = resolve(ROOT, spec.scenario)
  const spawn = () => {
    const peer = new Peer([opts.engine, ...TRANSPORT_ARGS[spec.transport]], env)
    peers.push(peer)
    return peer
  }
  const leftovers = (messages: unknown[]) => {
    for (const m of messages) failures.push(`LEFTOVER ${name} ${show(m)}`)
  }
  const persistent = spec.transport !== "oneshot"
  let completed = false
  let narrowed: string[] = []
  try {
    narrowed = await plantIn(runtime, spec.plant)
    let peer = persistent ? spawn() : undefined
    for (const [index, step] of spec.steps.entries()) {
      const label = `step=${index + 1}`
      if (step.restart) {
        if (peer) leftovers(await peer.close())
        peer = persistent ? spawn() : undefined
        continue
      }
      const target = peer ?? spawn()
      target.send(step.send)
      for (const [j, expectation] of step.expect.entries()) {
        const message = await target.next()
        const fail = (pointer: string, detail: string) =>
          failures.push(`MISMATCH ${name} ${label} message=${j + 1} ${pointer || "/"}: ${detail}`)
        if (message === undefined) {
          fail("", `no message within ${MESSAGE_TIMEOUT_MS} ms`)
          break
        }
        compare(expectation.message, message, "", { variable: new Set(expectation.variable), deltas, fail })
      }
      if (!peer) leftovers(await target.close())
      const found = step.sink === undefined ? undefined : await sinkCount(runtime)
      if (found !== step.sink)
        failures.push(`MISMATCH ${name} ${label} sink: expected ${step.sink} entries, found ${found}`)
    }
    if (peer) leftovers(await peer.close())
    const found = opts.assertSinkEmpty ? await sinkCount(runtime) : 0
    if (found !== 0) failures.push(`MISMATCH ${name} sink: expected empty, found ${found} entries`)
    completed = true
  } finally {
    for (const peer of peers) if (peer.proc.exitCode === null && peer.proc.signalCode === null) await peer.close()
    for (const d of deltas) console.error(`DELTA ${d.kind} ${d.pointer} matched=${d.matched}`)
    if (failures.length > 0) console.log(failures.join("\n"))
    else if (completed) console.log(`REPLAY_OK ${name} steps=${spec.steps.length}`)
    const alive = peers.filter((peer) => peer.proc.exitCode === null && peer.proc.signalCode === null).length
    for (const path of narrowed)
      await chmod(path, 0o700).catch((error: unknown) => console.log(`TEARDOWN ${path}: ${describe(error)}`))
    await rm(runtime, { recursive: true, force: true })
    console.log(`procs ${alive}\ndir REMOVED ${runtime}`)
  }
  return failures.length === 0 ? 0 : 1
}

try {
  process.exitCode = await replay(Bun.argv.slice(2))
} catch (error) {
  console.log(`REPLAY_ERROR ${describe(error)}`)
  process.exitCode = 2
}
