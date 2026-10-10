/**
 * (a) startup and (b) idle memory of an interactive TUI, listener OFF vs ON (plan todo 23).
 *
 * ONE senpi engine (`--engine-a`, `--engine-b` default to the same dir) and ONE omo launcher run two
 * builds of the omo plugin: `--plugin-a` and `--plugin-b` (default: this checkout's plugin). The
 * control is the component's test seam, never a shipped flag: arm A is a scratch, never-committed
 * build whose thread component is created with `sessionControl: null` (no control endpoint) and arm
 * B is the plugin as built. `--endpoints-a/-b` give the `tui` endpoint count each arm must register
 * in EVERY sample (default 0 and 1). Each arm keeps ONE isolated agent dir with the shared ready probe
 * (`-probe.mjs`) installed; one discarded warm-up per arm, then pairs interleaved A,B / B,A, one load
 * batch per pair. Per sample:
 * - `prompt_ms`: spawn to the editor prompt on screen; `first_echo_ms`: spawn to the echo of the first
 *   keystroke typed at it.
 * - `fully_ready_ms`: spawn to the moment the session_start work has settled. Arm with an endpoint:
 *   the later of the probe's `settled` mark and the endpoint's registry record (written right after
 *   its socket listens, so from then on it accepts a connection; a real connect is made to prove it).
 *   Arm without one: the probe's `settled` mark. Both are clocked by the TUI process itself.
 * - responsiveness: a keystroke every `ECHO_EVERY_MS` for `--echo-window-ms` after the prompt, each
 *   timed from write to echo, so a loop blocked while the listener comes up shows as a slow echo.
 * - memory, `--idle-ms` after the echo window: the probe forces two full collections and reports the
 *   engine's retained heap (size, extra memory, object count and per-type counts); then the whole
 *   process tree's RSS and physical footprint, the engine process's own footprint and thread count.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs"
import { createConnection } from "node:net"
import { join, resolve } from "node:path"

import { createBatches, delta, load1, stats } from "./task-host-e2e-gateway-cost-batch.mjs"
import { bootstrapDelta, installProbe, PROBE_ENV, probeMarks, settledMark } from "./task-host-e2e-gateway-cost-probe.mjs"
import { alive, commandOf, footprintMb, scanText, scanTree, sweepMarker, treeMemory } from "./task-host-e2e-gateway-cost-scan.mjs"

const gw = await import("./thread-tools/lib/gateway.mjs")
const { bus, waitFor, makeScratch, registryEndpoints, OMO_ROOT, KIT_DIR } = gw

const ECHO_EVERY_MS = 100
const ECHO_KEYS = "abcdefghijklmnopqrstuvwxyz"
const MIB = 1024 * 1024
const round1 = (value) => Math.round(value * 10) / 10
const epochNow = () => performance.timeOrigin + performance.now()

/** `<run>/kit-<side>/{node_modules/@code-yeongyu/senpi -> engine, omo/{bin,package.json,plugin}}`. */
function abInstall(runRoot, side, engineDir, pluginDir) {
  const engine = resolve(engineDir)
  for (const required of ["package.json", join("dist", "cli.js")]) if (!existsSync(join(engine, required))) throw new Error(`engine ${side} has no ${required} at ${engine}: build it first`)
  const plugin = resolve(pluginDir ?? join(OMO_ROOT, "packages", "omo-senpi", "plugin"))
  if (!existsSync(join(plugin, "extensions", "omo.js"))) throw new Error(`plugin ${side} has no extensions/omo.js at ${plugin}`)
  const kit = join(runRoot, `kit-${side}`)
  mkdirSync(join(kit, "node_modules", "@code-yeongyu"), { recursive: true })
  symlinkSync(engine, join(kit, "node_modules", "@code-yeongyu", "senpi"))
  const root = join(kit, "omo")
  cpSync(join(OMO_ROOT, "packages", "omo-native", "bin"), join(root, "bin"), { recursive: true })
  cpSync(join(OMO_ROOT, "packages", "omo-native", "package.json"), join(root, "package.json"))
  cpSync(plugin, join(root, "plugin"), { recursive: true })
  const hash = Bun.spawnSync(["shasum", "-a", "256", join(root, "plugin", "extensions", "omo.js")]).stdout.toString().split(" ")[0]
  return { side, engine, plugin, omoJsSha256: hash, engineVersion: JSON.parse(readFileSync(join(engine, "package.json"), "utf8")).version, omoJs: join(root, "bin", "omo.js") }
}

let Terminal
async function newTerminal(cols, rows) {
  if (Terminal === undefined) {
    const mod = await import(join(KIT_DIR, "node_modules", "@xterm", "headless", "lib-headless", "xterm-headless.js"))
    Terminal = mod.Terminal ?? mod.default?.Terminal
  }
  return new Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 })
}

/** The editor line holds `text` (what a typed keystroke looks like once the TUI handled it). */
function editorShows(term, text) {
  const buffer = term.buffer.active
  for (let row = 0; row < term.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ""
    if (line.startsWith("❯") && line.includes(text)) return true
  }
  return false
}

function promptVisible(term) {
  const buffer = term.buffer.active
  for (let row = 0; row < term.rows; row += 1) if ((buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "").startsWith("❯")) return true
  return false
}

const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(0, ms)))

function connectOnce(socket) {
  return new Promise((resolvePromise) => {
    const client = createConnection(socket)
    client.once("connect", () => {
      const at = epochNow()
      client.destroy()
      resolvePromise({ ok: true, at })
    })
    client.once("error", (error) => resolvePromise({ ok: false, error: error.code ?? String(error) }))
  })
}

/** Watches for this TUI's fresh `tui` record, then proves its endpoint accepts a connection. */
async function watchEndpoint(scratch, seen, label, exited) {
  const record = await waitFor(() => {
    if (exited()) throw new Error(`${label} exited before registering its endpoint`)
    return registryEndpoints(scratch.agentDir).find((endpoint) => endpoint.endpoint_kind === "tui" && !seen.has(endpoint.socket) && existsSync(endpoint.socket))
  }, { label: `${label} endpoint`, timeoutMs: 60_000 })
  seen.add(record.socket)
  const recordAt = statSync(join(record.dir, "endpoint.json")).mtimeMs
  return { recordAt, connect: await connectOnce(record.socket) }
}

/** One TUI start: timings, responsiveness, memory, endpoint count, then a full teardown of its tree. */
async function abSample(ctx, install, scratch, seen, index) {
  const term = await newTerminal(120, 40)
  const raw = []
  let exitCode
  const sample = { side: install.side, index, load1_start: load1() }
  const probeOut = join(scratch.dir, `probe-${index}-${Date.now()}.jsonl`)
  ctx.log(`ab ${install.side}${index} start`)
  const t0 = performance.now()
  const t0Epoch = epochNow()
  const proc = Bun.spawn([process.env.THREAD_QA_NODE ?? "node", install.omoJs], {
    cwd: scratch.work,
    env: { ...scratch.env, [PROBE_ENV]: probeOut },
    detached: true,
    terminal: { cols: 120, rows: 40, data: (_terminal, data) => {
      const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8")
      raw.push(text)
      term.write(text, () => bus.emit("tick", "pty"))
    } },
  })
  void proc.exited.then((code) => {
    exitCode = code
    bus.emit("tick", "exit")
  })
  sample.pid = proc.pid
  const label = `TUI ${install.side}${index}`
  const endpoint = install.expectEndpoints > 0 ? watchEndpoint(scratch, seen, label, () => exitCode !== undefined) : undefined
  endpoint?.catch(() => undefined)
  let tree = []
  try {
    sample.prompt_ms = await waitFor(() => {
      if (exitCode !== undefined) throw new Error(`${label} exited ${exitCode} before its prompt: ${raw.join("").slice(-600)}`)
      return promptVisible(term) ? performance.now() - t0 : undefined
    }, { label: `${label} prompt`, timeoutMs: 90_000 })
    // Responsiveness: one keystroke per slot over the window after the prompt, each timed write -> echo.
    const promptAt = performance.now()
    const echoes = []
    let typed = ""
    for (let slot = 0; performance.now() - promptAt < ctx.opts.echoWindowMs; slot += 1) {
      typed += ECHO_KEYS[slot % ECHO_KEYS.length]
      const sent = performance.now()
      proc.terminal.write(typed.at(-1))
      const shown = typed
      await waitFor(() => {
        if (exitCode !== undefined) throw new Error(`${label} exited ${exitCode} before echoing`)
        return editorShows(term, shown) ? true : undefined
      }, { label: `${label} echo ${slot}`, timeoutMs: 60_000 })
      echoes.push(round1(performance.now() - sent))
      if (slot === 0) sample.first_echo_ms = performance.now() - t0
      await pause(promptAt + (slot + 1) * ECHO_EVERY_MS - performance.now())
    }
    proc.terminal.write("\x15")
    sample.echo_latencies_ms = echoes
    sample.echo_max_ms = Math.max(...echoes)
    const settled = await waitFor(() => {
      if (exitCode !== undefined) throw new Error(`${label} exited ${exitCode} before its probe settled`)
      return settledMark(probeMarks(probeOut))
    }, { label: `${label} probe settled`, timeoutMs: 60_000 })
    sample.engine_pid = settled.pid
    sample.settled_ms = settled.at - t0Epoch
    if (endpoint !== undefined) {
      const seenEndpoint = await endpoint
      sample.endpoint_record_ms = seenEndpoint.recordAt - t0Epoch
      sample.endpoint_connect = seenEndpoint.connect.ok ? { ok: true, ms: seenEndpoint.connect.at - t0Epoch } : seenEndpoint.connect
      sample.fully_ready_ms = Math.max(sample.settled_ms, sample.endpoint_record_ms)
    } else {
      sample.fully_ready_ms = sample.settled_ms
    }
    // Idle memory, time-defined: the retained heap after forced collections, then the process tree.
    await pause(ctx.opts.idleMs)
    process.kill(settled.pid, "SIGUSR2")
    const heap = await waitFor(() => {
      if (exitCode !== undefined) throw new Error(`${label} exited ${exitCode} before its heap census`)
      return probeMarks(probeOut).find((mark) => mark.event === "heap" || mark.event === "heap_error")
    }, { label: `${label} heap census`, timeoutMs: 60_000 })
    if (heap.event === "heap_error") throw new Error(`${label} heap census failed: ${heap.error}`)
    Object.assign(sample, {
      heap_mb: round1(heap.heap_size / MIB),
      heap_extra_mb: round1(heap.extra_memory / MIB),
      heap_objects: heap.object_count,
      heap_object_types: heap.object_types,
      heap_runtime: heap.runtime,
      engine_rss_mb_inside: round1(heap.memory_usage.rss / MIB),
    })
    const memory = treeMemory(proc.pid)
    tree = memory.tree
    Object.assign(sample, { rss_mb: memory.rss_mb, footprint_mb: memory.footprint_mb, footprint_unmeasured: memory.footprint_unmeasured, processes: memory.processes })
    sample.engine_footprint_mb = footprintMb(settled.pid)
    sample.engine_threads = Math.max(0, Bun.spawnSync(["ps", "-M", "-p", String(settled.pid)]).stdout.toString().trim().split("\n").length - 1)
    sample.tui_endpoints = registryEndpoints(scratch.agentDir).filter((record) => record.endpoint_kind === "tui" && existsSync(record.socket)).length
    sample.load1_end = load1()
  } finally {
    try {
      process.kill(-proc.pid, "SIGTERM")
    } catch {
      // Already gone.
    }
    const exited = await Promise.race([proc.exited.then(() => true), pause(8000).then(() => false)])
    if (!exited) {
      try {
        process.kill(-proc.pid, "SIGKILL")
      } catch {
        // Gone.
      }
      await proc.exited
    }
    // Descendants that left the pty's group: killed only while their command still names this run.
    for (const entry of tree) if (entry.pid !== proc.pid && alive(entry.pid) && commandOf(entry.pid).includes(ctx.runRoot)) process.kill(entry.pid, "SIGKILL")
    sample.swept = sweepMarker(scratch.dir)
    scanText(ctx.scan, raw.join(""), `ab ${install.side}${index} pty`)
  }
  return sample
}

const METRICS = ["prompt_ms", "first_echo_ms", "settled_ms", "fully_ready_ms", "echo_max_ms", "heap_mb", "heap_extra_mb", "heap_objects", "engine_footprint_mb", "footprint_mb", "rss_mb", "engine_threads"]

/** Per arm min/p50/p95, the B - A deltas of each, the paired deltas, and bootstrap intervals of the median and p95 deltas. */
function compare(samples, pairs, key) {
  const a = samples.a.map((s) => s[key])
  const b = samples.b.map((s) => s[key])
  const sa = stats(a)
  const sb = stats(b)
  return {
    a: sa,
    b: sb,
    delta: { min: delta(sb.min, sa.min), p50: delta(sb.p50, sa.p50), p95: delta(sb.p95, sa.p95) },
    paired: stats(pairs.map((pair) => pair.b[key] - pair.a[key])),
    ci_p50: bootstrapDelta(a, b, 0.5),
    ci_p95: bootstrapDelta(a, b, 0.95),
  }
}

/** Object types whose median retained count differs most between the arms. */
function objectTypeDiff(samples) {
  const median = (values) => stats(values).p50 ?? 0
  const types = new Set([...samples.a, ...samples.b].flatMap((s) => Object.keys(s.heap_object_types ?? {})))
  return [...types]
    .map((type) => ({ type, a_p50: median(samples.a.map((s) => s.heap_object_types?.[type] ?? 0)), b_p50: median(samples.b.map((s) => s.heap_object_types?.[type] ?? 0)) }))
    .map((row) => ({ ...row, delta: round1(row.b_p50 - row.a_p50) }))
    .filter((row) => row.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 25)
}

/** Fills `out` as it goes, so a deadline or a failure still leaves every finished pair in the report. */
export async function abSection(ctx, fake, out) {
  const { opts } = ctx
  const a = { ...abInstall(ctx.runRoot, "a", opts.engineA, opts.pluginA), expectEndpoints: opts.endpointsA, label: opts.labelA }
  const b = { ...abInstall(ctx.runRoot, "b", opts.engineB ?? opts.engineA, opts.pluginB), expectEndpoints: opts.endpointsB, label: opts.labelB }
  ctx.log(`ab: A ${a.label} (omo.js ${a.omoJsSha256.slice(0, 12)}), B ${b.label} (omo.js ${b.omoJsSha256.slice(0, 12)}), engine ${a.engineVersion}`)
  Object.assign(out, {
    control_method: "one engine, one launcher; plugin A vs plugin B (the thread component's sessionControl seam)",
    arms: { a: { label: a.label, engine: a.engine, engine_version: a.engineVersion, plugin: a.plugin, omo_js_sha256: a.omoJsSha256, expect_tui_endpoints: a.expectEndpoints }, b: { label: b.label, engine: b.engine, engine_version: b.engineVersion, plugin: b.plugin, omo_js_sha256: b.omoJsSha256, expect_tui_endpoints: b.expectEndpoints } },
    same_engine: a.engine === b.engine,
    idle_ms: opts.idleMs,
    echo_window_ms: opts.echoWindowMs,
    target_pairs: opts.samples,
  })
  const sandbox = { a: makeScratch("t23a", fake), b: makeScratch("t23b", fake) }
  for (const side of ["a", "b"]) installProbe(sandbox[side].agentDir)
  const seen = { a: new Set(), b: new Set() }
  out.warmup = [await abSample(ctx, a, sandbox.a, seen.a, "w"), await abSample(ctx, b, sandbox.b, seen.b, "w")]
  const batches = createBatches("ab pair", { log: ctx.log, deadline: ctx.deadline, retakes: 2 })
  for (let index = 0; index < opts.samples; index += 1) {
    const order = index % 2 === 0 ? [a, b] : [b, a]
    const batch = await batches.run(`pair ${index}`, async () => {
      const pair = []
      for (const install of order) pair.push(await abSample(ctx, install, sandbox[install.side], seen[install.side], index))
      return pair
    })
    if (batch === undefined && ctx.deadline.reached()) break
    if (batch !== undefined) for (const s of batch.samples) ctx.log(`ab ${s.side}${index} prompt=${Math.round(s.prompt_ms)} ready=${Math.round(s.fully_ready_ms)} settled=${Math.round(s.settled_ms)}${s.endpoint_record_ms === undefined ? "" : ` record=${Math.round(s.endpoint_record_ms)}`} echo_max=${s.echo_max_ms} heap=${s.heap_mb}MB objs=${s.heap_objects} fp=${s.engine_footprint_mb}MB tui=${s.tui_endpoints} load=${batch.after.load[0]}`)
  }
  for (const side of ["a", "b"]) {
    scanTree(ctx.scan, sandbox[side].agentDir, `ab ${side} agent dir`)
    rmSync(sandbox[side].dir, { recursive: true, force: true })
  }
  const pairs = batches.accepted.map((batch) => Object.fromEntries(batch.samples.map((s) => [s.side, s])))
  const samples = { a: pairs.map((pair) => pair.a), b: pairs.map((pair) => pair.b) }
  Object.assign(out, {
    accepted_pairs: pairs.length,
    partial: pairs.length < opts.samples,
    batches: batches.summary(),
    samples,
    endpoint_check: {
      a_off_expected: samples.a.filter((s) => s.tui_endpoints !== a.expectEndpoints).length,
      b_off_expected: samples.b.filter((s) => s.tui_endpoints !== b.expectEndpoints).length,
      b_connect_failed: samples.b.filter((s) => b.expectEndpoints > 0 && s.endpoint_connect?.ok !== true).length,
    },
    metrics: Object.fromEntries(METRICS.map((key) => [key, compare(samples, pairs, key)])),
    echo_latency_pooled_ms: { a: stats(samples.a.flatMap((s) => s.echo_latencies_ms ?? [])), b: stats(samples.b.flatMap((s) => s.echo_latencies_ms ?? [])) },
    heap_object_type_diff: objectTypeDiff(samples),
  })
  return out
}
