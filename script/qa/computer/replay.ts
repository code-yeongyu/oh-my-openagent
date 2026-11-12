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
// With `--row <N>` (a `--dir` run) the list then classifies every case that did not replay clean
// by ruling R57 (replay-owners.ts) and prints `FAIL <case> <reason>` or `owed <case> row <M>` per
// case and the summary `replay-all R57 row=<N>: ok=.. skipped=.. failing=.. owed=..`; it exits 1
// when any case fails, else 0.
// Every case runs in a fresh temporary runtime dir (OMO_COMPUTER_RUNTIME_DIR) that is removed
// afterwards, so no case sees another's leftovers. `${RUNTIME_DIR}` in a case's env values is
// replaced with that dir, and a case may plant its starting state there before the engine starts:
// `"runtime": {"plant": [{"path": <relative>, "content": <text>, "mode": "0600"} |
// {"path": <relative>, "dir": true, "mode": "0500"}]}` (files default to 0600, parents are 0700,
// directory modes are applied after every file).
import { constants } from "node:fs"
import { access, chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import {
  casesIn,
  describe,
  InputError,
  isImported,
  parseCase,
  parseJson,
  plantIn,
  ROOT,
  readText,
  supersededBy,
  TRANSPORT_ARGS,
} from "./replay-case"
import { compare, loadDeltas, show } from "./replay-compare"
import { classify, type Outcome, readLedgers } from "./replay-owners"
import { MESSAGE_TIMEOUT_MS, Peer } from "./replay-peer"

const DEFAULT_DELTAS = join(ROOT, "crates/omo-computer-core/parity/ORACLE-DELTAS.tsv")
const SINK_PREFIX = "fake-sink-" // the engine's per-process sink file under OMO_COMPUTER_RUNTIME_DIR
const RUNTIME_PLACEHOLDER = "$" + "{RUNTIME_DIR}"

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
  readonly row: number | undefined
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
      "usage: replay.ts --engine <binary> --case <file> [--case <file> ...] [--dir <dir> ...] [--assert-sink-empty] [--deltas <tsv>] [--row <N>]",
    )
  const rowArg = value("--row")
  const row = rowArg === undefined ? undefined : Number(rowArg)
  if (row !== undefined && !(Number.isInteger(row) && row > 0 && dirs.length > 0))
    throw new InputError("--row needs a row number and a --dir")
  return {
    row,
    engine: resolve(engine),
    cases: cases.map((file) => resolve(file)),
    dirs: dirs.map((dir) => resolve(dir)),
    deltas: resolve(value("--deltas") ?? DEFAULT_DELTAS),
    assertSinkEmpty: argv.includes("--assert-sink-empty"),
  }
}

async function replay(argv: readonly string[]): Promise<number> {
  const opts = args(argv)
  const listed = [...opts.cases, ...(await Promise.all(opts.dirs.map(casesIn))).flat()]
  const skips = await supersededBy(listed)
  const only = listed[0]
  if (listed.length === 1 && opts.dirs.length === 0 && only !== undefined) return replayCase(opts, only)
  let code = 0
  const outcomes: Outcome[] = []
  for (const casePath of listed) {
    const skip = skips.get(casePath)
    if (skip) {
      console.log(`SKIPPED ${skip.old} superseded by ${skip.by}`)
      outcomes.push({ name: caseName(casePath), status: "skipped" })
      continue
    }
    let caseCode = 2
    try {
      caseCode = await replayCase(opts, casePath)
    } catch (error) {
      console.log(`REPLAY_ERROR ${describe(error)}`)
    }
    code = Math.max(code, caseCode)
    outcomes.push({ name: caseName(casePath), status: caseCode === 0 ? "ok" : "failed" })
  }
  if (opts.row === undefined) return code
  const verdict = classify(opts.row, outcomes, await readLedgers(join(ROOT, "crates/omo-computer-core/parity")))
  console.log(verdict.lines.join("\n"))
  return verdict.failing > 0 ? 1 : 0
}

// A case as its result lines name it: the repository-relative path, else the path given.
function caseName(casePath: string): string {
  const rel = relative(ROOT, casePath)
  return rel.startsWith("..") ? casePath : rel
}

async function replayCase(opts: Options, casePath: string): Promise<number> {
  const name = caseName(casePath)
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
