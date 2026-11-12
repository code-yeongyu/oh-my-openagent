#!/usr/bin/env bun
// Spike SP-R probe: relay and same-network pipe limits. Writes or re-verifies relay-limits.tsv.
//
//   bun probe-sp-r.ts --write  <ledger.tsv> [--only id,id]   measure and write the ledger
//   bun probe-sp-r.ts --verify <ledger.tsv> [--only id,id]   measure again; exit 0 only when every verdict matches
//
// Relay rows run against a LOCAL relay this probe starts itself from a relay checkout (SP_R_RELAY_CHECKOUT): the
// checkout's own local test harness serves it (workerd through wrangler dev --local) and every credential is minted
// here, signed by a key generated for the run and served by a loopback key server. No account, no hosted relay.
// The relay's wire details stay in that private checkout: this file uses only its harness API, and reads the socket
// route and the token claim shape from the checkout at run time.
// Same-network rows read a same-network pair through SP_R_PAIR_A/B (probe-sp-r-pair.sh); --self-test checks every
// verdict rule by class without a relay or a pair.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const HEADER = ["id", "pipe", "question", "measured", "verdict", "rerun", "host_build", "note"]
const LAN_REASON = "disabled by the relay daemon owner's ruling of 2026-11-11"
type Verdict = "CONFIRMS" | "CONTRADICTS" | "NEW-EDGE" | "UNMEASURED"
type Row = Readonly<{
  id: string
  pipe: string
  question: string
  measured: string
  verdict: Verdict
  note: string
}>

// ---- pure decisions (no I/O): every row's verdict passes through these, and --self-test exercises them ---------------
type Run = Readonly<{ measured: string; verdict: Verdict; note: string; errored?: true }>
type PairOut = Readonly<{ ok: true; fields: Record<string, string> }> | Readonly<{ ok: false; why: string }>
/** A failed measurement: UNMEASURED with its reason, flagged so --verify can never count it as a match. */
const failedRun = (why: string): Run => ({ measured: "-", verdict: "UNMEASURED", note: why, errored: true })
/** A row's outcome; a thrown probe error becomes UNMEASURED with the error as its reason. */
const settle = async (run: () => Promise<Run>): Promise<Run> => {
  try {
    return await run()
  } catch (e) {
    return failedRun(`probe error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
/** --verify: a fresh outcome matches the ledger only when it was measured (never when a failure produced it). */
const verdictMatches = (ledger: Verdict, r: Run): boolean => r.errored !== true && ledger === r.verdict
/** The pair helper's exit code and stdout, as one host's result: only exit 0 with the helper's own fields counts. */
const parsePairOut = (side: "A" | "B", code: number, out: string): PairOut => {
  if (code === 75 || out.startsWith("busy"))
    return { ok: false, why: `host ${side} load at or above its core count, stopped` }
  if (code === 2)
    return { ok: false, why: `precondition missing on host ${side}: ${out.trim().split("\n").pop() ?? ""}` }
  if (code !== 0) return { ok: false, why: `host ${side} unreachable or dropped mid-run (exit ${code})` }
  const fields: Record<string, string> = {}
  for (const m of out.matchAll(/(?:^|\s)([a-z_]+)=([^\s]*)/g)) if (m[1] !== undefined) fields[m[1]] = m[2] ?? ""
  if (fields["load"] === undefined)
    return { ok: false, why: `host ${side} returned no helper fields (exit 0): its exec prefix ran nothing` }
  return { ok: true, fields }
}
/** The shell command that runs the pair helper on one host through its exec prefix (the prefix must keep argv). */
const pairCommand = (prefix: string, helperB64: string, helperArgs: string): string =>
  `${prefix} sh -c "echo ${helperB64} | base64 -d | sh -s -- ${helperArgs}"`
type ReproveQa = Readonly<{
  before: { hibernated: number; reconnectsPerRefresh: number }
  after: { hibernated: number; reconnectsPerRefresh: number; reproveMs: number[] }
}>
/** R-AUTH-4 (re-proof client) and R-AUTH-5 (client without re-proof) from the relay's own re-proof QA. */
const reproveRun = (m: ReproveQa | null, client: "reprove" | "legacy", note: string): Run => {
  if (m === null) return failedRun("the relay checkout's re-proof QA reported nothing")
  if (client === "reprove")
    return {
      measured: `hub evicted ${m.after.hibernated}/1, reconnects per refresh ${m.after.reconnectsPerRefresh}, re-proof ${m.after.reproveMs.join("/")} ms`,
      verdict: m.after.hibernated === 1 && m.after.reconnectsPerRefresh === 0 ? "CONFIRMS" : "CONTRADICTS",
      note,
    }
  return {
    measured: `hub evicted ${m.before.hibernated}/1, reconnects per refresh ${m.before.reconnectsPerRefresh} (drained)`,
    verdict: m.before.hibernated === 1 && m.before.reconnectsPerRefresh === 1 ? "NEW-EDGE" : "CONTRADICTS",
    note,
  }
}
/** The close code the relay sends when its dead window ends a silent channel. */
const DEAD_WINDOW_CLOSE = 4000
type Silent = Readonly<{ openAt150: boolean; closedAfterS: number | null; closeCode: number | null; evicted: boolean }>
/** R-HIB-5 (how long a silent channel lives) and R-LIVE-120-2 (does it outlive 120 s): only the dead-window close counts. */
const silentRun = (m: Silent, row: "R-HIB-5" | "R-LIVE-120-2", note: string): Run => {
  if (m.openAt150) return { measured: "open at 150 s", verdict: row === "R-HIB-5" ? "CONTRADICTS" : "CONFIRMS", note }
  if (m.closedAfterS === null || m.closeCode !== DEAD_WINDOW_CLOSE)
    return failedRun(
      `closed after ${m.closedAfterS ?? "?"} s with code ${m.closeCode ?? "none"}, not the relay's dead-window close (${DEAD_WINDOW_CLOSE})`,
    )
  const short = m.closedAfterS < 120
  if (row === "R-HIB-5")
    return {
      measured: `closed after ${m.closedAfterS} s, code ${m.closeCode}, hub evicted ${m.evicted}`,
      verdict: short ? "NEW-EDGE" : "CONTRADICTS",
      note,
    }
  return {
    measured: `closed after ${m.closedAfterS} s, code ${m.closeCode}`,
    verdict: short ? "CONTRADICTS" : "CONFIRMS",
    note,
  }
}
/** L-STATE-*: a zero is trusted only after the helper's positive lsof control passed and the target was visible. */
const stateRun = (m: PairOut, note: string): Run => {
  if (!m.ok) return failedRun(m.why)
  const f = m.fields
  if (f["device_service"] !== "running") return failedRun("no device service running on the host")
  if (f["control"] !== "ok" || f["target_visible"] !== "yes")
    return failedRun(
      `lsof positive control did not pass (control=${f["control"] ?? "none"}, target_visible=${f["target_visible"] ?? "none"})`,
    )
  const off = f["listeners_off_loopback"] === "0" && f["udp_discovery_sockets"] === "0"
  return {
    measured: `lsof control ok (${f["control_listeners"] ?? "?"} listeners seen, ${f["control_off_loopback"] ?? "?"} off loopback); device service ${f["version"] ?? ""}; listeners ${f["listeners_total"] ?? "?"} (off loopback ${f["listeners_off_loopback"] ?? "?"}); unix sockets ${f["unix_sockets"] ?? "?"}; discovery sockets ${f["udp_discovery_sockets"] ?? "?"}; load ${f["load"] ?? "?"}/${f["cores"] ?? "?"}`,
    verdict: off ? "CONTRADICTS" : "NEW-EDGE",
    note,
  }
}
/** Waits for a socket to open: an error, a close or ms without an open rejects (the caller's row is UNMEASURED). */
const awaitOpen = (ws: WebSocket, ms = 10_000): Promise<void> =>
  new Promise<void>((ok, no) => {
    const timer = setTimeout(() => {
      ws.close()
      no(new Error(`socket did not open within ${ms} ms`))
    }, ms)
    ws.addEventListener("open", () => (clearTimeout(timer), ok()), { once: true })
    ws.addEventListener("error", () => (clearTimeout(timer), no(new Error("socket failed to open"))), { once: true })
    ws.addEventListener("close", (e) => (clearTimeout(timer), no(new Error(`socket closed before open (${e.code})`))), {
      once: true,
    })
  })
/** Runs the pair helper on one host through its exec prefix and reads its result. */
const runOnPair = async (prefix: string, helperB64: string, helperArgs: string, timeoutS: number): Promise<PairOut> => {
  const run = async (cmd: string): Promise<{ code: number; out: string }> => {
    const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => proc.kill(), timeoutS * 1000)
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    return { code, out }
  }
  // A prefix that joins its arguments into one string (ssh does) would run "sh -c echo" and return nothing; refuse it.
  const canary = await run(`${prefix} sh -c 'echo sp-r-argv-$((6*7))'`)
  if (!canary.out.includes("sp-r-argv-42"))
    return { ok: false, why: `host A exec prefix does not keep its arguments (canary exit ${canary.code})` }
  const r = await run(pairCommand(prefix, helperB64, helperArgs))
  return parsePairOut("A", r.code, r.out)
}
/** R-HOSTED-1-*: the hosted silent unadmitted socket against the relay's hello deadline and the local close code. */
const hostedRun = (m: PairOut, ref: { afterOpenMs: number; code: string }, deadlineMs: number, note: string): Run => {
  if (!m.ok) return failedRun(m.why)
  const opened = Number(m.fields["opened_ms"] ?? "NaN")
  const ms = Number(m.fields["closed_after_open_ms"] ?? "NaN")
  const code = m.fields["code"] ?? ""
  if (!(opened >= 0) || !(ms >= 0) || !/^\d+$/.test(code))
    return failedRun(
      `hosted socket gave no close result (opened_ms=${m.fields["opened_ms"] ?? "none"}, code=${code || "none"})`,
    )
  const ok = ms >= deadlineMs - 500 && ms <= deadlineMs + 2_000 && code === ref.code
  return {
    measured: `hosted closed ${ms} ms after open, code ${code}; hello deadline ${deadlineMs} ms; local relay (this run, loaded build host) closed ${ref.afterOpenMs} ms after open, code ${ref.code}`,
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    note,
  }
}
/** Rows whose rerun needs the same-network pair and the hosted relay configured. */
const PAIR_IDS = new Set(["L-STATE-A", "L-STATE-B", "R-HOSTED-1-A", "R-HOSTED-1-B"])
/** The rerun command recorded for a ledger row (the environment it needs, and nothing more). */
const rerunFor = (id: string): string =>
  `CI=true SP_R_RELAY_CHECKOUT=<relay checkout> ${PAIR_IDS.has(id) ? "SP_R_PAIR_A=<exec on pair host A> SP_R_PAIR_B=<exec on pair host B> SP_R_HOSTED_RELAY=<wss://hosted relay> " : ""}bun crates/omo-computer-engine/probes/probe-sp-r.ts --verify crates/omo-computer-engine/probes/relay-limits.tsv --only ${id}`

// ---- --self-test: class-level checks of every decision above, plus the pair helper's own checks ----------------------
const selfTest = async (): Promise<number> => {
  let fails = 0
  const check = (name: string, ok: boolean, detail = ""): void => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || detail === "" ? "" : ` -- ${detail}`}`)
    if (!ok) fails += 1
  }
  const VERDICTS: readonly Verdict[] = ["CONFIRMS", "CONTRADICTS", "NEW-EDGE", "UNMEASURED"]
  const failed = (r: Run): boolean => r.verdict === "UNMEASURED" && r.errored === true && r.note !== ""
  const bounded = <T>(ms: number, p: Promise<T>): Promise<T | "hung"> =>
    Promise.race([p, Bun.sleep(ms).then(() => "hung" as const)])

  // M2: every failure source is UNMEASURED with its reason, and --verify never matches it.
  const throwers: readonly (readonly [string, () => Promise<Run>])[] = [
    ["Error", () => Promise.reject(new Error("boom"))],
    ["string", () => Promise.reject("boom")],
    ["undefined", () => Promise.reject(undefined)],
    [
      "sync throw",
      () => {
        throw new Error("sync boom")
      },
    ],
  ]
  for (const [name, run] of throwers) {
    const r = await settle(run)
    check(`M2 settle(${name}) -> UNMEASURED with reason`, failed(r), JSON.stringify(r))
  }
  for (const v of VERDICTS) {
    check(
      `M2 verify rejects an errored outcome against ledger ${v}`,
      !verdictMatches(v, { measured: "-", verdict: v, note: "x", errored: true }),
    )
    check(`M2 verify still matches a measured ${v}`, verdictMatches(v, { measured: "m", verdict: v, note: "x" }))
  }
  for (const client of ["reprove", "legacy"] as const) {
    const r = reproveRun(null, client, "n")
    check(`M2 empty relay re-proof (${client}) -> UNMEASURED`, failed(r), JSON.stringify(r))
  }
  // M2: the pair result class: only exit 0 with the helper's fields is a result; everything else is a failure.
  const outs = ["", "\n", "garbage words", "busy load=9 cores=8", "load=1 cores=8", "load=1 cores=8\ncontrol=ok"]
  for (const code of [0, 1, 2, 75, 124, 127, 130, 255])
    for (const out of outs) {
      const r = parsePairOut("A", code, out)
      const want = code === 0 && /(^|\s)load=/.test(out) && !out.startsWith("busy")
      check(
        `M2 pair result exit ${code} out ${JSON.stringify(out)} -> ${want ? "ok" : "failure"}`,
        r.ok === want,
        JSON.stringify(r),
      )
      if (!r.ok) check(`M2 pair failure carries a reason (exit ${code})`, r.why !== "")
    }
  // M2: the transport class: an exec prefix that joins its arguments, or prints nothing, never yields a result.
  const work = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "sp-r-selftest."))
  try {
    await Bun.write(`${work}/join`, '#!/bin/sh\nexec sh -c "$*"\n')
    await Bun.write(`${work}/silent`, "#!/bin/sh\nexit 0\n")
    chmodSync(`${work}/join`, 0o755)
    chmodSync(`${work}/silent`, 0o755)
    const fakeHelper = Buffer.from('echo "load=1 cores=8 argc=$# first=$1"\n').toString("base64")
    const keep = await runOnPair("env", fakeHelper, "state", 20)
    check(
      "M2 argv-preserving prefix -> helper result",
      keep.ok && keep.fields["first"] === "state",
      JSON.stringify(keep),
    )
    for (const [name, prefix] of [
      ["joining (ssh-style)", `${work}/join`],
      ["prints nothing, exit 0", `${work}/silent`],
    ] as const) {
      const r = await runOnPair(prefix, fakeHelper, "state", 20)
      check(`M2 ${name} prefix -> failure with reason`, !r.ok && r.why !== "", JSON.stringify(r))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  // M1 (probe side): a zero is trusted only with the helper's positive control and a visible target.
  const base = {
    ok: true,
    fields: {
      device_service: "running",
      version: "1",
      listeners_total: "0",
      listeners_off_loopback: "0",
      udp_discovery_sockets: "0",
      load: "1",
      cores: "8",
    },
  } as const
  const stateCases: readonly (readonly [string, Record<string, string>, Verdict | "failed"])[] = [
    ["no control fields", {}, "failed"],
    ["control failed", { control: "fail", target_visible: "yes" }, "failed"],
    ["target not visible", { control: "ok", target_visible: "no" }, "failed"],
    ["control ok, zeros", { control: "ok", target_visible: "yes" }, "CONTRADICTS"],
    [
      "control ok, off-loopback listener",
      { control: "ok", target_visible: "yes", listeners_total: "1", listeners_off_loopback: "1" },
      "NEW-EDGE",
    ],
    ["control ok, discovery socket", { control: "ok", target_visible: "yes", udp_discovery_sockets: "1" }, "NEW-EDGE"],
    ["control ok, no device service", { control: "ok", target_visible: "yes", device_service: "absent" }, "failed"],
  ]
  for (const [name, extra, want] of stateCases) {
    const r = stateRun({ ok: true, fields: { ...base.fields, ...extra } }, "n")
    check(
      `M1 L-STATE ${name} -> ${want}`,
      want === "failed" ? failed(r) : r.verdict === want && r.errored !== true,
      JSON.stringify(r),
    )
  }
  check("M1 L-STATE helper failure -> UNMEASURED", failed(stateRun({ ok: false, why: "lsof missing" }, "n")))
  // M2: hosted rows: a helper failure or missing fields never becomes a verdict.
  const ref = { afterOpenMs: 10_000, code: "4004" }
  const hostedCases: readonly (readonly [string, PairOut, Verdict | "failed"])[] = [
    ["helper failure", { ok: false, why: "host B unreachable" }, "failed"],
    ["no fields", { ok: true, fields: { load: "1", cores: "8" } }, "failed"],
    [
      "never opened",
      { ok: true, fields: { load: "1", opened_ms: "-1", closed_after_open_ms: "-1", code: "open_at_90s" } },
      "failed",
    ],
    [
      "on the deadline",
      { ok: true, fields: { load: "1", opened_ms: "300", closed_after_open_ms: "9990", code: "4004" } },
      "CONFIRMS",
    ],
    [
      "late",
      { ok: true, fields: { load: "1", opened_ms: "300", closed_after_open_ms: "30000", code: "4004" } },
      "CONTRADICTS",
    ],
  ]
  for (const [name, m, want] of hostedCases) {
    const r = hostedRun(m, ref, 10_000, "n")
    check(
      `M2 R-HOSTED-1 ${name} -> ${want}`,
      want === "failed" ? failed(r) : r.verdict === want && r.errored !== true,
      JSON.stringify(r),
    )
  }
  // LOW: the silent-peer rows need the relay's dead-window close (4000); any other code is not that figure.
  for (const after of [null, 30, 59, 60, 119, 120, 150])
    for (const code of [4000, 1000, 1006, 4003, 4004]) {
      const m = {
        openAt150: after === null,
        closedAfterS: after,
        closeCode: after === null ? null : code,
        evicted: true,
      }
      for (const row of ["R-HIB-5", "R-LIVE-120-2"] as const) {
        const r = silentRun(m, row, "n")
        const name = `LOW ${row} ${after === null ? "open at 150 s" : `closed ${after} s code ${code}`}`
        if (after === null)
          check(
            `${name} -> ${row === "R-HIB-5" ? "CONTRADICTS" : "CONFIRMS"}`,
            r.verdict === (row === "R-HIB-5" ? "CONTRADICTS" : "CONFIRMS") && r.errored !== true,
            JSON.stringify(r),
          )
        else if (code !== 4000)
          check(`${name} -> UNMEASURED naming the code`, failed(r) && r.note.includes(String(code)), JSON.stringify(r))
        else {
          const want =
            after < 120
              ? row === "R-HIB-5"
                ? "NEW-EDGE"
                : "CONTRADICTS"
              : row === "R-HIB-5"
                ? "CONTRADICTS"
                : "CONFIRMS"
          check(
            `${name} -> ${want}, code recorded`,
            r.verdict === want && r.measured.includes("code 4000"),
            JSON.stringify(r),
          )
        }
      }
    }
  // LOW: every socket open is bounded and fails on error.
  const refused = new WebSocket("ws://127.0.0.1:1/")
  check(
    "LOW open on a refused port rejects within 3 s",
    (await bounded(
      3_000,
      awaitOpen(refused, 1_000).then(
        () => "opened",
        () => "rejected",
      ),
    )) === "rejected",
  )
  const mute = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${mute.port}/`)
    check(
      "LOW open on a server that never upgrades rejects within 3 s",
      (await bounded(
        3_000,
        awaitOpen(ws, 500).then(
          () => "opened",
          () => "rejected",
        ),
      )) === "rejected",
    )
  } finally {
    mute.stop(true)
  }
  const good = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
    websocket: { message() {} },
  })
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${good.port}/`)
    check(
      "LOW open on a real websocket server resolves",
      (await bounded(
        3_000,
        awaitOpen(ws, 2_000).then(
          () => "opened",
          () => "rejected",
        ),
      )) === "opened",
    )
    ws.close()
  } finally {
    await good.stop(true)
  }
  // LOW: rerunFor reproduces every committed rerun string exactly.
  const ledgerRows = readFileSync(join(import.meta.dir, "relay-limits.tsv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
  for (const r of ledgerRows)
    check(`LOW rerun string of ${r[0]} reproduced`, r[5] === rerunFor(r[0] ?? ""), `ledger: ${r[5]}`)
  // LOW (plan lane L4): no public file names a numbered issue, and the same-network reason carries no reference.
  for (const f of [
    "probe-sp-r.ts",
    "probe-sp-r-pair.sh",
    "probe-sp-r-pair-selftest.sh",
    "README.md",
    "relay-limits.tsv",
  ]) {
    const path = join(import.meta.dir, f)
    const text = existsSync(path) ? readFileSync(path, "utf8") : ""
    const refs = text.match(/(^|[^\w&/])#\d{2,}\b/gm) ?? []
    check(`L4 ${f} names no numbered issue`, refs.length === 0, refs.join(" "))
  }
  check(
    "L4 same-network reason text",
    LAN_REASON === "disabled by the relay daemon owner's ruling of 2026-11-11",
    LAN_REASON,
  )
  // M1 (helper side): the pair helper's own class checks.
  const helperTest = join(import.meta.dir, "probe-sp-r-pair-selftest.sh")
  if (!existsSync(helperTest)) check("M1 pair helper self-test exists", false, helperTest)
  else {
    const proc = Bun.spawn(["sh", helperTest, join(import.meta.dir, "probe-sp-r-pair.sh")], {
      stdout: "inherit",
      stderr: "inherit",
    })
    check("M1 pair helper self-test passes", (await proc.exited) === 0)
  }
  console.log(fails === 0 ? "self-test: all checks passed" : `self-test: ${fails} check(s) failed`)
  return fails === 0 ? 0 : 1
}
if (process.argv[2] === "--self-test") process.exit(await selfTest())

function die(line: string, code = 2): never {
  console.error(`probe-sp-r: ${line}`)
  process.exit(code)
}

const args = process.argv.slice(2)
const mode = args[0]
const ledger = args[1]
if ((mode !== "--write" && mode !== "--verify") || ledger === undefined)
  die("usage: probe-sp-r.ts --write|--verify <ledger.tsv> [--only id,id]")
const onlyAt = args.indexOf("--only")
const only = onlyAt === -1 ? null : new Set((args[onlyAt + 1] ?? "").split(","))
const ledgerPath = resolve(ledger)

// Preconditions, checked before anything is measured or written.
const checkout = process.env["SP_R_RELAY_CHECKOUT"]
if (checkout === undefined || checkout === "")
  die(
    "precondition missing: no relay endpoint configured (SP_R_RELAY_CHECKOUT must name a relay checkout whose local relay this probe starts)",
  )
const harnessDir = join(checkout, "packages/adapter-a/test")
const fixturePath = join(checkout, "vendor/omo-service-relay-fixture/fixture.json")
for (const f of ["flow-server.ts", "relay-peer.ts", "hello.ts", "qa-reprove-hibernation.ts"])
  if (!existsSync(join(harnessDir, f))) die(`precondition missing: ${checkout} has no local relay harness (${f})`)
if (!existsSync(fixturePath)) die(`precondition missing: ${checkout} has no service token fixture`)
if (process.platform !== "linux")
  die(`precondition missing: the local relay runs on Linux only (this is ${process.platform})`)
if (process.env["CI"] !== "true" && !existsSync("/.dockerenv") && !existsSync("/run/.containerenv"))
  die("precondition missing: the relay harness needs CI=true or a container on a Linux host")

// ---- the relay harness, loaded from the checkout -------------------------------------------------------------------
type DevServer = Readonly<{ base: string; stop: () => Promise<void> }>
type Reply = Readonly<{ kind: string }> | undefined
type Envelope = Readonly<{ envelope_id: string; sealed: Uint8Array }>
type PeerT = {
  ws: WebSocket | undefined
  received: Map<string, unknown>
  onDeliver: (e: Envelope) => void
  connect(): Promise<void>
  envelope(to: string, cls: "stream" | "data", body: string): Envelope
  send(e: Envelope): Promise<Reply>
  sync(): Promise<void>
}
type Harness = Readonly<{
  flowServer: (deadAfterMs?: number, hooks?: boolean, access?: Record<string, string>) => Promise<DevServer>
  Peer: new (base: string, account: string, device: string) => PeerT
  rewakeDoor: (base: string, account: string) => Promise<void>
  openSocket: (url: string) => WebSocket
  admit: (ws: WebSocket, token?: string) => Promise<void>
  deviceJkt: (device: string) => Promise<string>
  ping: string
}>
// The relay protocol module, named the way the harness imports it (its name is the relay checkout's business).
const protoSpecifier = /from "([^"]+\/proto)"/.exec(readFileSync(join(harnessDir, "hello.ts"), "utf8"))?.[1]
if (protoSpecifier === undefined) die(`precondition missing: ${checkout} harness has no protocol import`)
const h = {
  ...((await import(join(harnessDir, "flow-server.ts"))) as Pick<Harness, "flowServer">),
  ...((await import(join(harnessDir, "relay-peer.ts"))) as Pick<Harness, "Peer" | "rewakeDoor">),
  ...((await import(join(harnessDir, "hello.ts"))) as Pick<Harness, "openSocket" | "admit" | "deviceJkt">),
  ping: ((await import(Bun.resolveSync(protoSpecifier, harnessDir))) as { RELAY_PING: string }).RELAY_PING,
} satisfies Harness

// The device socket route and the per-account hook prefix, as the harness itself builds them.
const peerSrc = readFileSync(join(harnessDir, "relay-peer.ts"), "utf8")
const socketTpl = /`ws:\/\/\$\{this\.base\}(\/[^`]*\/socket)`/.exec(peerSrc)?.[1]
const hookTpl = /`http:\/\/\$\{base\}(\/[^`]*)\$\{path\}`/.exec(peerSrc)?.[1]
if (socketTpl === undefined || hookTpl === undefined)
  die(`precondition missing: ${checkout} harness no longer exposes its socket route`)
const socketUrl = (base: string, account: string, device: string): string =>
  `ws://${base}${socketTpl.replace("${this.account}", account).replace("${this.device}", device)}`
const hookUrl = (base: string, account: string, path: string): string =>
  `http://${base}${hookTpl.replace("${account}", account)}${path}`
const instanceOf = async (base: string, account: string): Promise<string> =>
  ((await (await fetch(hookUrl(base, account, "__stats"))).json()) as { instance: string }).instance

// ---- test credentials: the service fixture's claim shape, re-signed by a key minted for this run ---------------------
type Claims = Record<string, unknown>
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  issuer: string
  account: string
  relay: Record<string, string>
}
const payloadOf = (jwt: string): Claims =>
  JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as Claims
const [tplA, tplB] = Object.values(fixture.relay).map(payloadOf)
if (tplA === undefined || tplB === undefined) die(`precondition missing: ${fixturePath} has no relay tokens`)
// The device claim is the one whose value differs between the fixture's two device tokens.
const deviceClaim = Object.keys(tplA).find((k) => typeof tplA[k] === "string" && tplA[k] !== tplB[k])
const accountClaim = Object.keys(tplA).find((k) => tplA[k] === fixture.account)
if (deviceClaim === undefined || accountClaim === undefined)
  die(`precondition missing: ${fixturePath} token shape not recognised`)
const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair
const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
const KID = "sp-r-probe"
const b64 = (x: unknown): string => Buffer.from(JSON.stringify(x)).toString("base64url")
const mint = async (account: string, device: string, lifeS: number): Promise<string> => {
  const now = Math.floor(Date.now() / 1000)
  const body: Claims = {
    ...tplA,
    [accountClaim]: account,
    [deviceClaim]: device,
    iat: now,
    exp: now + lifeS,
    jti: crypto.randomUUID(),
    cnf: { jkt: await h.deviceJkt(device) },
  }
  const signing = `${b64({ alg: "ES256", typ: "JWT", kid: KID })}.${b64(body)}`
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signing),
  )
  return `${signing}.${Buffer.from(sig).toString("base64url")}`
}

// ---- small timing helpers ------------------------------------------------------------------------------------------
const sleep = (ms: number): Promise<void> => Bun.sleep(ms)
const uid = (p: string): string => `${p}-${crypto.randomUUID().slice(0, 8)}`
const keepalive = (sockets: readonly (WebSocket | undefined)[]): (() => void) => {
  const t = setInterval(() => {
    for (const ws of sockets) if (ws?.readyState === WebSocket.OPEN) ws.send(h.ping)
  }, 5_000)
  return () => clearInterval(t)
}
const closedAt = (ws: WebSocket): Promise<{ at: number; code: number }> =>
  new Promise((done) => ws.addEventListener("close", (e) => done({ at: Date.now(), code: e.code }), { once: true }))
const within = <T>(ms: number, p: Promise<T>): Promise<T | "timeout"> =>
  Promise.race([p, sleep(ms).then(() => "timeout" as const)])
const pairOn = async (base: string): Promise<{ account: string; brain: PeerT; hand: PeerT }> => {
  const account = uid("sp-r")
  const brain = new h.Peer(base, account, "brain")
  const hand = new h.Peer(base, account, "hand")
  for (const peer of [brain, hand])
    if ((await within(15_000, peer.connect())) === "timeout") throw new Error("relay peer did not connect within 15 s")
  // The hand answers every brain ping with its own stream envelope, as a hand link's heartbeat reply would.
  hand.onDeliver = (e) => {
    const body = new TextDecoder().decode(e.sealed)
    if (body.startsWith("ping-")) void hand.send(hand.envelope("brain", "stream", `pong-${body.slice(5)}`))
  }
  return { account, brain, hand }
}
const roundTrip = (p: { brain: PeerT }, n: number, timeoutMs = 15_000): Promise<number | "timeout"> => {
  const sent = performance.now()
  const back = new Promise<number>((done) => {
    const prev = p.brain.onDeliver
    p.brain.onDeliver = (e) => {
      if (new TextDecoder().decode(e.sealed) === `pong-${n}`) {
        p.brain.onDeliver = prev
        done(performance.now() - sent)
      }
    }
  })
  void p.brain.send(p.brain.envelope("hand", "stream", `ping-${n}`))
  return within(timeoutMs, back)
}
const closeAll = (...peers: PeerT[]): void => {
  for (const p of peers) p.ws?.close()
}

// ---- measurements (memoised: a row that shares a measurement with another runs it once) -----------------------------
let privateRelay: Promise<DevServer> | undefined
let hostedRelay: Promise<DevServer> | undefined
let keyServer: ReturnType<typeof Bun.serve> | undefined
// DEAD_AFTER_MS left at the relay's shipped 60,000 ms so the silent-link numbers are the relay's own.
const relayPrivate = (): Promise<DevServer> => (privateRelay ??= h.flowServer(60_000, true))
const relayHosted = (): Promise<DevServer> => {
  keyServer ??= Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] }),
  })
  return (hostedRelay ??= h.flowServer(60_000, true, {
    RELAY_MODE: "production",
    ENTITLEMENT_ISSUER: fixture.issuer,
    ENTITLEMENT_JWKS_URL: `http://127.0.0.1:${keyServer.port}/jwks.json`,
  }))
}
const memo = new Map<string, Promise<unknown>>()
const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  if (!memo.has(key)) memo.set(key, run())
  return memo.get(key) as Promise<T>
}

/** Smallest idle time (from a 5 s transport keepalive sweep) after which the account object was evicted. */
const mEvict = () =>
  once("evict", async () => {
    const base = (await relayPrivate()).base
    const idle = [5, 10, 15, 20, 30]
    const res = await Promise.all(
      idle.map(async (s) => {
        const p = await pairOn(base)
        await roundTrip(p, 0)
        const before = await instanceOf(base, p.account)
        const stop = keepalive([p.brain.ws, p.hand.ws])
        await sleep(s * 1000)
        stop()
        const open = p.brain.ws?.readyState === WebSocket.OPEN && p.hand.ws?.readyState === WebSocket.OPEN
        const evicted = (await instanceOf(base, p.account)) !== before
        closeAll(p.brain, p.hand)
        return { s, evicted, open }
      }),
    )
    const firstEvicted = res.find((r) => r.evicted)?.s ?? null
    const lastKept =
      [...res].reverse().find((r) => !r.evicted && (firstEvicted === null || r.s < firstEvicted))?.s ?? null
    return { res, firstEvicted, lastKept, allOpen: res.every((r) => r.open) }
  })

/** One hibernation between two heartbeat round trips: idle 20 s on the transport keepalive only. */
const mWake = () =>
  once("wake", async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    const warm = await roundTrip(p, 1)
    const before = await instanceOf(base, p.account)
    const stop = keepalive([p.brain.ws, p.hand.ws])
    await sleep(20_000)
    stop()
    const open = p.brain.ws?.readyState === WebSocket.OPEN && p.hand.ws?.readyState === WebSocket.OPEN
    const wake = await roundTrip(p, 2)
    const cmd = p.brain.envelope("hand", "data", "command-after-wake")
    await p.brain.send(cmd)
    await p.hand.sync()
    const dataDelivered = p.hand.received.has(cmd.envelope_id)
    const evicted = (await instanceOf(base, p.account)) !== before
    closeAll(p.brain, p.hand)
    return { warm, wake, open, dataDelivered, evicted }
  })

/** A 5 s heartbeat for 60 s; with rewake, the account object is given a hibernation wake's memory at +30 s. */
const mCadence = (rewake: boolean) =>
  once(`cadence-${rewake}`, async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    const before = await instanceOf(base, p.account)
    const rtts: number[] = []
    const arrivals: number[] = [Date.now()]
    let lost = 0
    for (let i = 0; i < 12; i++) {
      const tick = sleep(5_000)
      if (rewake && i === 6) await h.rewakeDoor(base, p.account)
      const r = await roundTrip(p, 100 + i)
      if (r === "timeout") lost += 1
      else {
        rtts.push(r)
        arrivals.push(Date.now())
      }
      await tick
    }
    const gaps = arrivals.slice(1).map((t, i) => t - (arrivals[i] ?? t))
    const evicted = (await instanceOf(base, p.account)) !== before
    closeAll(p.brain, p.hand)
    const sorted = [...rtts].sort((a, b) => a - b)
    return {
      lost,
      p95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? Number.NaN,
      maxGap: Math.max(...gaps),
      evicted,
    }
  })

/** How long an idle channel lives across hibernation: with the 5 s transport keepalive (150 s) or silent. */
const mSurvive = (silent: boolean) =>
  once(`survive-${silent}`, async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    await roundTrip(p, 1)
    const before = await instanceOf(base, p.account)
    const start = Date.now()
    if (p.hand.ws === undefined) throw new Error("hand socket missing")
    const closed = closedAt(p.hand.ws)
    const stop = silent ? () => undefined : keepalive([p.brain.ws, p.hand.ws])
    const end = await within(150_000, closed)
    stop()
    const delivered = end === "timeout" ? (await roundTrip(p, 2)) !== "timeout" : false
    const evicted = (await instanceOf(base, p.account)) !== before
    closeAll(p.brain, p.hand)
    return {
      openAt150: end === "timeout",
      closedAfterS: end === "timeout" ? null : Math.round((end.at - start) / 1000),
      closeCode: end === "timeout" ? null : end.code,
      delivered,
      evicted,
    }
  })

/** Largest sealed payload the relay admits for a class, and how it refuses one byte more. */
const mSize = (cls: "stream" | "data") =>
  once(`size-${cls}`, async () => {
    const base = (await relayPrivate()).base
    const p = await pairOn(base)
    // Paced under the relay's per-pair rate so a refusal can only be the size.
    // "codec": the relay's shared codec (used by both ends) refused to encode the frame, so it never left the hand.
    const tryN = async (n: number): Promise<"ok" | "refused" | "closed" | "codec"> => {
      await sleep(cls === "data" ? 250 : 150)
      if (p.brain.ws?.readyState !== WebSocket.OPEN) await p.brain.connect()
      let r: Reply
      try {
        r = await p.brain.send(p.brain.envelope("hand", cls, "x".repeat(n)))
      } catch {
        return "codec"
      }
      return r === undefined ? "closed" : r.kind === "ack" ? "ok" : "refused"
    }
    let lo = 1
    let hi = 1 << 20
    if ((await tryN(lo)) !== "ok") return { max: 0, over: "refused", stable: false }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if ((await tryN(mid)) === "ok") lo = mid
      else hi = mid
    }
    const over = await tryN(lo + 1)
    const stable = (await tryN(lo)) === "ok"
    closeAll(p.brain, p.hand)
    return { max: lo, over, stable }
  })

/** Largest single WebSocket message the relay's runtime takes before the relay parses it (close 1009 = too big). */
const mTransport = () =>
  once("transport", async () => {
    const base = (await relayPrivate()).base
    const closeFor = async (n: number): Promise<number | "open"> => {
      const ws = h.openSocket(socketUrl(base, uid("sp-r-raw"), "hand"))
      await awaitOpen(ws)
      const closed = new Promise<{ at: number; code: number }>((done) => {
        ws.addEventListener("close", (e) => done({ at: Date.now(), code: e.code }), { once: true })
      })
      ws.send(new Uint8Array(n))
      const end = await within(20_000, closed)
      if (end === "timeout") ws.close()
      return end === "timeout" ? "open" : end.code
    }
    let lo = 64 * 1024
    let hi = 64 * 1024 * 1024
    // Only 1009 (message too big) is a size refusal; the relay closes an unadmitted socket for a bad frame or a
    // missed hello deadline with codes of its own, and those mean the runtime took the message.
    const atHi = await closeFor(hi)
    if (atHi !== 1009) return { cap: null, overCode: atHi }
    if ((await closeFor(lo)) === 1009) return { cap: 0, overCode: atHi }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if ((await closeFor(mid)) === 1009) hi = mid
      else lo = mid
    }
    return { cap: lo, overCode: await closeFor(lo + 1) }
  })

/** An admitted device socket whose token expires in 25 s and is never refreshed. */
const mExpiry = (hibernate: boolean) =>
  once(`expiry-${hibernate}`, async () => {
    const base = (await relayHosted()).base
    const account = uid("sp-r-auth")
    const device = "hand"
    const ws = h.openSocket(socketUrl(base, account, device))
    await awaitOpen(ws)
    const expS = Math.floor(Date.now() / 1000) + 25
    await h.admit(ws, await mint(account, device, expS - Math.floor(Date.now() / 1000)))
    const before = await instanceOf(base, account)
    const closed = closedAt(ws)
    const stop = keepalive([ws])
    // Awake: an HTTP request every 3 s keeps the account object resident; hibernate: nothing but the keepalive.
    const poke = hibernate ? undefined : setInterval(() => void instanceOf(base, account), 3_000)
    const end = await within(60_000, closed)
    stop()
    clearInterval(poke)
    const evicted = (await instanceOf(base, account)) !== before
    if (end === "timeout") ws.close()
    return {
      afterExpS: end === "timeout" ? null : Math.round((end.at - expS * 1000) / 100) / 10,
      code: end === "timeout" ? null : end.code,
      evicted,
    }
  })

/** A hello whose token expired 10 s ago. */
const mExpiredHello = () =>
  once("expired-hello", async () => {
    const base = (await relayHosted()).base
    const account = uid("sp-r-auth")
    const ws = h.openSocket(socketUrl(base, account, "hand"))
    await awaitOpen(ws)
    const outcome = await h
      .admit(ws, await mint(account, "hand", -10))
      .then(() => "admitted")
      .catch((e: Error) => e.message)
    ws.close()
    return { admitted: outcome === "admitted", outcome }
  })

/** The relay's own hibernation re-proof QA (one run): a token refresh after a real hibernation, both client kinds. */
const mRefresh = () =>
  once("refresh", async () => {
    const proc = Bun.spawn(["bun", "test/qa-reprove-hibernation.ts", "1"], {
      cwd: join(checkout, "packages/adapter-a"),
      stdout: "pipe",
      stderr: "ignore",
      env: process.env,
    })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    const line = out
      .trim()
      .split("\n")
      .reverse()
      .find((l) => l.startsWith("{"))
    if (code !== 0 || line === undefined) return null
    return JSON.parse(line) as ReproveQa
  })

// ---- a same-network pair (two hosts on one network), reached through SP_R_PAIR_A / SP_R_PAIR_B ----------------------
// Each is a command prefix that runs one shell command string on that host. probe-sp-r-pair.sh is sent along with it.
const pairExec = (side: "A" | "B"): string => process.env[`SP_R_PAIR_${side}`] ?? ""
const pairHelper = Buffer.from(readFileSync(join(import.meta.dir, "probe-sp-r-pair.sh"))).toString("base64")
const onPair = async (side: "A" | "B", args: string, timeoutS: number): Promise<PairOut> => {
  const r = await runOnPair(pairExec(side), pairHelper, args, timeoutS)
  return r.ok ? r : { ok: false, why: r.why.replace(/^host A /, `host ${side} `) }
}
const hostedSocket = (): string => {
  const base = process.env["SP_R_HOSTED_RELAY"] ?? ""
  return `${base}${socketTpl.replace("${this.account}", "sp-r-probe").replace("${this.device}", "silent")}`
}
const mPairState = (side: "A" | "B") => once(`state-${side}`, () => onPair(side, "state", 60))
const mPairSilent = (side: "A" | "B") => once(`silent-${side}`, () => onPair(side, `silent ${hostedSocket()}`, 120))
/** The same silent unadmitted socket against the local relay, for the hosted comparison. */
const mLocalSilent = () =>
  once("silent-local", async () => {
    const base = (await relayPrivate()).base
    const t0 = Date.now()
    const ws = new WebSocket(socketUrl(base, uid("sp-r-silent"), "silent"))
    await awaitOpen(ws)
    const opened = Date.now() - t0
    const end = await within(90_000, closedAt(ws))
    if (end === "timeout") ws.close()
    return end === "timeout"
      ? { afterOpenMs: -1, code: "open_at_90s" }
      : { afterOpenMs: end.at - t0 - opened, code: String(end.code) }
  })
// The relay's own hello deadline, read from the checkout (the silent unadmitted socket is closed by it).
const helloDeadlineMs = Number(
  (
    /HELLO_DEADLINE_MS = ([\d_]+)/.exec(readFileSync(join(checkout, "packages/core/src/hello.ts"), "utf8"))?.[1] ??
    "NaN"
  ).replaceAll("_", ""),
)

// ---- the rows ------------------------------------------------------------------------------------------------------
type Spec = Readonly<{
  id: string
  pipe: string
  question: string
  run: () => Promise<Run>
}>
const ms = (x: number | "timeout"): string => (x === "timeout" ? "timeout" : `${Math.round(x)} ms`)
const overText = (o: string): string =>
  o === "codec"
    ? "refused by the shared relay codec before send"
    : o === "refused"
      ? "refused by the relay, channel stays open"
      : o
const relayNote = "local relay (workerd via wrangler dev --local), test credentials minted by the probe"

const relay: Spec[] = [
  {
    id: "R-AUTH-1",
    pipe: "relay",
    question:
      "auth lifetime, awake hub: an admitted channel whose token is never refreshed closes at token expiry (no channel outlives its auth)",
    run: async () => {
      const m = await mExpiry(false)
      const ok = m.afterExpS !== null && m.afterExpS >= 0 && m.afterExpS <= 5 && !m.evicted
      return {
        measured: `closed ${m.afterExpS ?? "never (60 s)"} s after exp, code ${m.code ?? "-"}, hub evicted ${m.evicted}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-AUTH-2",
    pipe: "relay",
    question:
      "auth lifetime across one hub hibernation: the expiry still closes the channel when the hub was evicted before it",
    run: async () => {
      const m = await mExpiry(true)
      const ok = m.afterExpS !== null && m.afterExpS >= 0 && m.afterExpS <= 5
      return {
        measured: `closed ${m.afterExpS ?? "never (60 s)"} s after exp, code ${m.code ?? "-"}, hub evicted ${m.evicted}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; condition holds only when hub evicted is true`,
      }
    },
  },
  {
    id: "R-AUTH-3",
    pipe: "relay",
    question: "auth lifetime at dial: a token already expired is refused before the channel is admitted",
    run: async () => {
      const m = await mExpiredHello()
      return {
        measured: m.admitted ? "admitted" : `refused before admission (${m.outcome.replace(/\s+/g, " ")})`,
        verdict: m.admitted ? "CONTRADICTS" : "CONFIRMS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-AUTH-4",
    pipe: "relay",
    question:
      "unattended refresh after one hub hibernation, client advertising in-band re-proof: the channel stays up (0 reconnects)",
    run: async () =>
      reproveRun(
        await mRefresh(),
        "reprove",
        `${relayNote}; measured by the relay checkout's own hibernation re-proof QA, 1 run`,
      ),
  },
  {
    id: "R-AUTH-5",
    pipe: "relay",
    question: "refresh after one hub hibernation, client without in-band re-proof: what the relay does",
    run: async () =>
      reproveRun(
        await mRefresh(),
        "legacy",
        `${relayNote}; the hand's relay client must advertise re-proof or reconnect once per refresh after a hibernation`,
      ),
  },
  {
    id: "R-AUTH-6",
    pipe: "relay",
    question: "token lifetime the account service issues, and the relay's cap on one token's window",
    run: () =>
      Promise.resolve({
        measured: "-",
        verdict: "UNMEASURED",
        note: "needs a test account",
      }),
  },
  {
    id: "R-HIB-1",
    pipe: "relay",
    question:
      "hub hibernation onset: idle time after which the hub is evicted while both channels stay open (5 s transport keepalive)",
    run: async () => {
      const m = await mEvict()
      const list = m.res.map((r) => `${r.s}s:${r.evicted ? "evicted" : "resident"}`).join(" ")
      return {
        measured: `${list}; channels open ${m.allOpen}`,
        verdict: m.firstEvicted !== null && m.allOpen ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; hub keeps no process state across hibernation and the channels survive it; onset is the local runtime's, not the hosted one's`,
      }
    },
  },
  {
    id: "R-HIB-2",
    pipe: "relay",
    question: "does the durable channel survive one hub hibernation: same sockets, heartbeat round trip after the wake",
    run: async () => {
      const m = await mWake()
      const ok = m.evicted && m.open && m.wake !== "timeout"
      return {
        measured: `hub evicted ${m.evicted}, sockets open ${m.open}, round trip warm ${ms(m.warm)} / first after wake ${ms(m.wake)}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-HIB-3",
    pipe: "relay",
    question: "a command sent right after one hub hibernation is delivered (nothing lost across the wake)",
    run: async () => {
      const m = await mWake()
      return {
        measured: `hub evicted ${m.evicted}, command delivered ${m.dataDelivered}`,
        verdict: m.evicted && m.dataDelivered ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-HIB-4",
    pipe: "relay",
    question: "for how long a hibernated channel lives with the 5 s transport keepalive (observed to 150 s)",
    run: async () => {
      const m = await mSurvive(false)
      return {
        measured: `open at 150 s ${m.openAt150}, heartbeat after ${m.delivered}, hub evicted ${m.evicted}`,
        verdict: m.openAt150 && m.delivered ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-HIB-5",
    pipe: "relay",
    question: "for how long a hibernated channel lives with no traffic at all (silent peer)",
    run: async () =>
      silentRun(await mSurvive(true), "R-HIB-5", `${relayNote}; relay dead window left at its shipped 60,000 ms`),
  },
  {
    id: "R-SIZE-1",
    pipe: "relay",
    question: "message-size limit, stream class: largest sealed payload admitted, and the refusal one byte over",
    run: async () => {
      const m = await mSize("stream")
      return {
        measured: `max ${m.max} B sealed; ${m.max + 1} B ${overText(m.over)}; max re-admitted ${m.stable}`,
        verdict: m.max > 0 && m.stable ? "NEW-EDGE" : "CONTRADICTS",
        note: `${relayNote}; frames above the cap need an off-channel artifact path`,
      }
    },
  },
  {
    id: "R-SIZE-3",
    pipe: "relay",
    question:
      "message-size limit at the transport: largest single WebSocket message the relay runtime accepts before parsing it",
    run: async () => {
      const m = await mTransport()
      return {
        measured:
          m.cap === null
            ? `no transport refusal up to 64 MiB (largest tried); a 64 MiB message got ${m.overCode === "open" ? "no close in 20 s" : `close ${m.overCode}`}`
            : `max ${m.cap} B per WebSocket message; one byte more ends the socket (close ${m.overCode}, message too large)`,
        verdict: "NEW-EDGE",
        note: `${relayNote}; unadmitted socket, raw bytes; local runtime only, the hosted runtime message cap is not measured here; every relayed message is held to the codec cap of R-SIZE-1/2`,
      }
    },
  },
  {
    id: "R-SIZE-2",
    pipe: "relay",
    question:
      "message-size limit, data (stored command) class: largest sealed payload admitted, and the refusal one byte over",
    run: async () => {
      const m = await mSize("data")
      return {
        measured: `max ${m.max} B sealed; ${m.max + 1} B ${overText(m.over)}; max re-admitted ${m.stable}`,
        verdict: m.max > 0 && m.stable ? "NEW-EDGE" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-5-1",
    pipe: "relay",
    question: "5 s heartbeat, no hibernation in reach: 12 beats at 5 s all answered within 5 s, hub never evicted",
    run: async () => {
      const m = await mCadence(false)
      const ok = m.lost === 0 && m.p95 < 5_000 && !m.evicted
      return {
        measured: `lost ${m.lost}/12, p95 round trip ${Math.round(m.p95)} ms, hub evicted ${m.evicted}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; a 5 s heartbeat keeps the hub resident (see R-HIB-1 onset)`,
      }
    },
  },
  {
    id: "R-LIVE-5-2",
    pipe: "relay",
    question: "5 s window across one hibernation: the first heartbeat after a wake is answered within 5 s",
    run: async () => {
      const m = await mWake()
      const ok = m.evicted && m.wake !== "timeout" && m.wake < 5_000
      return {
        measured: `hub evicted ${m.evicted}, first round trip after wake ${ms(m.wake)}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-15-1",
    pipe: "relay",
    question: "15 s window across one hibernation: 5 s cadence plus the wake round trip stays under 15 s",
    run: async () => {
      const m = await mWake()
      const ok = m.evicted && m.wake !== "timeout" && 5_000 + m.wake < 15_000
      return {
        measured: `hub evicted ${m.evicted}, worst beat gap 5000 + ${ms(m.wake)}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-15-2",
    pipe: "relay",
    question:
      "15 s window with a hibernation wake (state loss) injected mid-run under the 5 s cadence: largest gap between answered beats",
    run: async () => {
      const m = await mCadence(true)
      const ok = m.lost === 0 && m.maxGap < 15_000
      return {
        measured: `lost ${m.lost}/12, largest gap ${m.maxGap} ms`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note: `${relayNote}; the wake is the relay's own test hook (hibernation-wake memory, sockets kept)`,
      }
    },
  },
  {
    id: "R-LIVE-120-1",
    pipe: "relay",
    question: "120 s window across hibernation with the 5 s transport keepalive: the channel outlives 120 s",
    run: async () => {
      const m = await mSurvive(false)
      return {
        measured: `open at 150 s ${m.openAt150}, hub evicted ${m.evicted}`,
        verdict: m.openAt150 && m.delivered ? "CONFIRMS" : "CONTRADICTS",
        note: relayNote,
      }
    },
  },
  {
    id: "R-LIVE-120-2",
    pipe: "relay",
    question: "120 s window across hibernation with a silent peer: the channel outlives 120 s",
    run: async () =>
      silentRun(
        await mSurvive(true),
        "R-LIVE-120-2",
        `${relayNote}; design question for the lead, see the row's finding R-LIVE-120-2 in the task evidence; R4's 120 s deadline is unchanged until the lead rules`,
      ),
  },
]

const lanQuestions: readonly (readonly [string, string])[] = [
  ["L-AUTH-1", "auth lifetime of the same-network pipe"],
  ["L-HIB-1", "behaviour across one hibernation: does the pairing channel survive, for how long"],
  ["L-SIZE-1", "message-size limit"],
  ["L-LIVE-5", "5 s heartbeat window survives one hibernation"],
  ["L-LIVE-15", "15 s window survives one hibernation"],
  ["L-LIVE-120", "120 s window survives one hibernation"],
  ["L-KEY-1", "what binds the per-device pairing key"],
  ["L-ENROLL-1", "re-enrollment yields a new hand id"],
  ["L-MITM-1", "pairing handshake posture against a machine in the middle"],
]
const pairNote = "a same-network pair of machines, read-only"
const stateSpec = (side: "A" | "B"): Spec => ({
  id: `L-STATE-${side}`,
  pipe: "lan",
  question: `same-network direct path on a shipped build, pair host ${side}: does the device service listen off loopback or open discovery sockets`,
  run: async () =>
    stateRun(
      await mPairState(side),
      `${pairNote}; CONTRADICTS = the free same-network pipe the design assumes is absent on the shipped build (owner ruling 2026-11-11)`,
    ),
})
const silentSpec = (side: "A" | "B"): Spec => ({
  id: `R-HOSTED-1-${side}`,
  pipe: "relay",
  question: `hosted relay, from pair host ${side}: a silent unadmitted socket closes at the relay's hello deadline (within +2 s), with the local relay's close code`,
  run: async () => {
    const [m, ref] = await Promise.all([mPairSilent(side), mLocalSilent()])
    return hostedRun(
      m,
      ref,
      helloDeadlineMs,
      `${pairNote}; one unauthenticated socket, no account, no frame sent; the deadline is the hello deadline, not the admitted channel's dead window`,
    )
  },
})
const pairSpecs: Spec[] = [
  stateSpec("A"),
  stateSpec("B"),
  silentSpec("A"),
  silentSpec("B"),
  {
    id: "R-HOSTED-2",
    pipe: "relay",
    question: "hosted relay: when a silent ADMITTED channel closes (the hosted counterpart of R-LIVE-120-2)",
    run: () => Promise.resolve({ measured: "-", verdict: "UNMEASURED", note: "needs a test account" }),
  },
]
const lan: Spec[] = lanQuestions.map(([id, question]) => ({
  id,
  pipe: "lan",
  question,
  run: () => Promise.resolve({ measured: "-", verdict: "UNMEASURED", note: LAN_REASON }),
}))

// ---- run ----------------------------------------------------------------------------------------------------------
const tsv = (s: string): string => s.replace(/[\t\n]/g, " ")
const read = (path: string): Row[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
    .map(([id = "", pipe = "", question = "", measured = "", verdict = "", , , note = ""]) => ({
      id,
      pipe,
      question,
      measured,
      verdict: verdict as Verdict,
      note,
    }))

const relayBuild = (): string => {
  const sha = Bun.spawnSync(["git", "-C", checkout, "rev-parse", "--short=12", "HEAD"]).stdout.toString().trim()
  const wrangler = (
    JSON.parse(readFileSync(Bun.resolveSync("wrangler/package.json", harnessDir), "utf8")) as { version: string }
  ).version
  const kernel = Bun.spawnSync(["uname", "-r"]).stdout.toString().trim()
  return `linux-${process.arch} ${kernel}; bun ${Bun.version}; wrangler ${wrangler}; relay ${sha}`
}
const pairBuild = (build: string): string =>
  `${build}; pair: two macOS hosts on one network, read through SP_R_PAIR_A/B`
const specs = [...relay, ...pairSpecs, ...lan].filter((s) => only === null || only.has(s.id))
const needsPair = specs.some((s) => s.id.startsWith("L-STATE") || s.id.startsWith("R-HOSTED-1"))
if (needsPair && (pairExec("A") === "" || pairExec("B") === ""))
  die(
    "precondition missing: no same-network pair configured (SP_R_PAIR_A and SP_R_PAIR_B must each run a command on one host of the pair)",
  )
if (specs.some((s) => s.id.startsWith("R-HOSTED-1")) && !/^wss:\/\/[^/]+$/.test(process.env["SP_R_HOSTED_RELAY"] ?? ""))
  die("precondition missing: no hosted relay configured (SP_R_HOSTED_RELAY must be wss://<host>)")
let status = 0
try {
  const results: (Row & Run)[] = await Promise.all(
    specs.map(async (s) => ({ id: s.id, pipe: s.pipe, question: s.question, ...(await settle(s.run)) })),
  )
  const build = relayBuild()
  for (const r of results) console.log(`${r.id}\t${r.verdict}\t${r.measured}`)
  if (mode === "--write") {
    const line = (r: Row): string =>
      [
        r.id,
        r.pipe,
        r.question,
        r.measured,
        r.verdict,
        rerunFor(r.id),
        r.id.startsWith("L-") || r.id.startsWith("R-HOSTED") ? pairBuild(build) : build,
        r.note,
      ]
        .map(tsv)
        .join("\t")
    // With --only, the other rows of an existing ledger are kept as they are; rows follow the probe's own order.
    const kept = new Map<string, string>()
    if (only !== null && existsSync(ledgerPath))
      for (const l of readFileSync(ledgerPath, "utf8").trim().split("\n").slice(1)) kept.set(l.split("\t")[0] ?? "", l)
    for (const r of results) kept.set(r.id, line(r))
    const order = [...relay, ...pairSpecs, ...lan].map((s) => s.id)
    const lines = [HEADER.join("\t"), ...order.flatMap((id) => kept.get(id) ?? [])]
    writeFileSync(ledgerPath, `${lines.join("\n")}\n`)
    console.log(`wrote ${results.length} rows`)
  } else {
    const known = new Map(read(ledgerPath).map((r) => [r.id, r]))
    for (const r of results) {
      const was = known.get(r.id)
      if (was === undefined) {
        console.log(`DIFF ${r.id}: not in the ledger`)
        status = 1
      } else if (!verdictMatches(was.verdict, r)) {
        console.log(
          `DIFF ${r.id}: ledger ${was.verdict}, measured ${r.verdict}${r.errored === true ? ` (failed: ${r.note})` : ""}`,
        )
        status = 1
      }
    }
    if (only === null)
      for (const id of known.keys())
        if (!results.some((r) => r.id === id)) {
          console.log(`DIFF ${id}: in the ledger, no probe for it`)
          status = 1
        }
    console.log(status === 0 ? `verify: ${results.length} rows, every verdict identical` : "verify: verdicts differ")
  }
} finally {
  const servers = await Promise.allSettled([privateRelay, hostedRelay].filter((p) => p !== undefined))
  for (const s of servers) if (s.status === "fulfilled" && s.value !== undefined) await s.value.stop()
  await keyServer?.stop(true)
}
process.exit(status)
