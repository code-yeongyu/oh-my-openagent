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
// ---- one gate: a verdict requires a fully valid measurement record ------------------------------------------------
// Every measured row is decided by a rule below, and every rule is reached through judge(): a record with a missing,
// non-finite, negative, sentinel or wrongly typed field is UNMEASURED before its rule ever sees it.
type Kind =
  | "count" // integer >= 0
  | "ms" // finite number >= 0
  | "code" // WebSocket close code, 1000..4999
  | "bool"
  | "text" // a non-empty string that is not a placeholder
  | Readonly<{ oneOf: readonly string[] }>
  | Readonly<{ opt: Kind }> // null is a measured "did not happen"; a missing field is still invalid
  | Readonly<{ list: Kind }> // non-empty
type Rec = Readonly<Record<string, unknown>>
type Rule = Readonly<{ schema: Readonly<Record<string, Kind>>; sample: Rec; decide: (r: Rec, note: string) => Run }>
const PLACEHOLDERS = new Set(["", "?", "-", "timeout", "open", "open_at_90s", "nan", "undefined", "null", "none"])
const fieldOk = (k: Kind, v: unknown): boolean => {
  if (typeof k === "object") {
    if ("opt" in k) return v === null || fieldOk(k.opt, v)
    if ("list" in k) return Array.isArray(v) && v.length > 0 && v.every((x: unknown) => fieldOk(k.list, x))
    return typeof v === "string" && k.oneOf.includes(v)
  }
  switch (k) {
    case "count":
      return typeof v === "number" && Number.isInteger(v) && v >= 0
    case "ms":
      return typeof v === "number" && Number.isFinite(v) && v >= 0
    case "code":
      return typeof v === "number" && Number.isInteger(v) && v >= 1000 && v <= 4999
    case "bool":
      return typeof v === "boolean"
    case "text":
      // A bare negative number ("-1") is the usual "not measured" placeholder, never a measured text.
      return typeof v === "string" && !PLACEHOLDERS.has(v.trim().toLowerCase()) && !/^\s*-\d/.test(v)
  }
}
/** The first field of a record that its rule's schema does not accept, or null. */
const invalidField = (rule: Rule, r: Rec): string | null => {
  for (const [field, kind] of Object.entries(rule.schema)) if (!(field in r) || !fieldOk(kind, r[field])) return field
  return null
}
const num = (r: Rec, k: string): number => r[k] as number
const optNum = (r: Rec, k: string): number | null => r[k] as number | null
const flag = (r: Rec, k: string): boolean => r[k] as boolean
const str = (r: Rec, k: string): string => r[k] as string
const msText = (x: number | null): string => (x === null ? "timeout" : `${Math.round(x)} ms`)
const overText = (o: string): string =>
  o === "codec"
    ? "refused by the shared relay codec before send"
    : o === "refused"
      ? "refused by the relay, channel stays open"
      : o
/** The relay's close code when its dead window ends a silent channel. */
const DEAD_WINDOW_CLOSE = 4000
// afterExpS is the distance from token expiry to the close; closedEarly says the close came before the expiry.
const EXPIRY = { afterExpS: { opt: "ms" }, closedEarly: "bool", code: { opt: "code" }, evicted: "bool" } as const
const expiryText = (r: Rec): string => {
  const after = optNum(r, "afterExpS")
  const when =
    after === null ? "never (60 s)" : flag(r, "closedEarly") ? `${after} s before exp` : `${after} s after exp`
  return `closed ${when}, code ${optNum(r, "code") ?? "-"}, hub evicted ${flag(r, "evicted")}`
}
const WAKE = { warm: { opt: "ms" }, wake: { opt: "ms" }, open: "bool", dataDelivered: "bool", evicted: "bool" } as const
const KEEPALIVE = { openAt150: "bool", delivered: "bool", evicted: "bool" } as const
const SILENT = {
  openAt150: "bool",
  closedAfterS: { opt: "count" },
  closeCode: { opt: "code" },
  evicted: "bool",
} as const
const SIZE = { max: "count", over: { oneOf: ["ok", "refused", "closed", "codec"] }, stable: "bool" } as const
const CADENCE = { lost: "count", p95: { opt: "ms" }, maxGap: { opt: "ms" }, evicted: "bool" } as const
const wakeSample = { warm: 120, wake: 180, open: true, dataDelivered: true, evicted: true }
const silentRule = (row: "R-HIB-5" | "R-LIVE-120-2"): Rule => ({
  schema: SILENT,
  sample: { openAt150: false, closedAfterS: 60, closeCode: 4000, evicted: true },
  decide: (r, note) => {
    if (flag(r, "openAt150"))
      return { measured: "open at 150 s", verdict: row === "R-HIB-5" ? "CONTRADICTS" : "CONFIRMS", note }
    const after = optNum(r, "closedAfterS")
    const code = optNum(r, "closeCode")
    if (after === null || code !== DEAD_WINDOW_CLOSE)
      return failedRun(
        `closed after ${after ?? "?"} s with code ${code ?? "none"}, not the relay's dead-window close (${DEAD_WINDOW_CLOSE})`,
      )
    const short = after < 120
    if (row === "R-HIB-5")
      return {
        measured: `closed after ${after} s, code ${code}, hub evicted ${flag(r, "evicted")}`,
        verdict: short ? "NEW-EDGE" : "CONTRADICTS",
        note,
      }
    return { measured: `closed after ${after} s, code ${code}`, verdict: short ? "CONTRADICTS" : "CONFIRMS", note }
  },
})
const sizeRule: Rule = {
  schema: SIZE,
  sample: { max: 65536, over: "codec", stable: true },
  decide: (r, note) => ({
    measured: `max ${num(r, "max")} B sealed; ${num(r, "max") + 1} B ${overText(str(r, "over"))}; max re-admitted ${flag(r, "stable")}`,
    verdict: num(r, "max") > 0 && flag(r, "stable") ? "NEW-EDGE" : "CONTRADICTS",
    note,
  }),
}
const RULES: Readonly<Record<string, Rule>> = {
  "R-AUTH-1": {
    schema: EXPIRY,
    sample: { afterExpS: 0.1, closedEarly: false, code: 4003, evicted: false },
    decide: (r, note) => {
      const after = optNum(r, "afterExpS")
      return {
        measured: expiryText(r),
        verdict:
          after !== null && !flag(r, "closedEarly") && after <= 5 && !flag(r, "evicted") ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
  "R-AUTH-2": {
    schema: EXPIRY,
    sample: { afterExpS: 0.1, closedEarly: false, code: 4003, evicted: true },
    decide: (r, note) => {
      const after = optNum(r, "afterExpS")
      return {
        measured: expiryText(r),
        verdict: after !== null && !flag(r, "closedEarly") && after <= 5 ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
  "R-AUTH-3": {
    schema: { admitted: "bool", outcome: "text" },
    sample: { admitted: false, outcome: "closed before admission: 4003 entitlement" },
    decide: (r, note) => ({
      measured: flag(r, "admitted")
        ? "admitted"
        : `refused before admission (${str(r, "outcome").replace(/\s+/g, " ")})`,
      verdict: flag(r, "admitted") ? "CONTRADICTS" : "CONFIRMS",
      note,
    }),
  },
  "R-AUTH-4": {
    schema: { hibernated: "count", reconnectsPerRefresh: "count", reproveMs: { list: "ms" } },
    sample: { hibernated: 1, reconnectsPerRefresh: 0, reproveMs: [137] },
    decide: (r, note) => ({
      measured: `hub evicted ${num(r, "hibernated")}/1, reconnects per refresh ${num(r, "reconnectsPerRefresh")}, re-proof ${(r["reproveMs"] as number[]).join("/")} ms`,
      verdict: num(r, "hibernated") === 1 && num(r, "reconnectsPerRefresh") === 0 ? "CONFIRMS" : "CONTRADICTS",
      note,
    }),
  },
  "R-AUTH-5": {
    schema: { hibernated: "count", reconnectsPerRefresh: "count" },
    sample: { hibernated: 1, reconnectsPerRefresh: 1 },
    decide: (r, note) => ({
      measured: `hub evicted ${num(r, "hibernated")}/1, reconnects per refresh ${num(r, "reconnectsPerRefresh")} (drained)`,
      verdict: num(r, "hibernated") === 1 && num(r, "reconnectsPerRefresh") === 1 ? "NEW-EDGE" : "CONTRADICTS",
      note,
    }),
  },
  "R-HIB-1": {
    schema: { sweep: "text", firstEvicted: { opt: "count" }, allOpen: "bool" },
    sample: { sweep: "5s:resident 10s:evicted", firstEvicted: 10, allOpen: true },
    decide: (r, note) => ({
      measured: `${str(r, "sweep")}; channels open ${flag(r, "allOpen")}`,
      verdict: optNum(r, "firstEvicted") !== null && flag(r, "allOpen") ? "CONFIRMS" : "CONTRADICTS",
      note,
    }),
  },
  "R-HIB-2": {
    schema: WAKE,
    sample: wakeSample,
    decide: (r, note) => ({
      measured: `hub evicted ${flag(r, "evicted")}, sockets open ${flag(r, "open")}, round trip warm ${msText(optNum(r, "warm"))} / first after wake ${msText(optNum(r, "wake"))}`,
      verdict: flag(r, "evicted") && flag(r, "open") && optNum(r, "wake") !== null ? "CONFIRMS" : "CONTRADICTS",
      note,
    }),
  },
  "R-HIB-3": {
    schema: WAKE,
    sample: wakeSample,
    decide: (r, note) => ({
      measured: `hub evicted ${flag(r, "evicted")}, command delivered ${flag(r, "dataDelivered")}`,
      verdict: flag(r, "evicted") && flag(r, "dataDelivered") ? "CONFIRMS" : "CONTRADICTS",
      note,
    }),
  },
  "R-HIB-4": {
    schema: KEEPALIVE,
    sample: { openAt150: true, delivered: true, evicted: true },
    decide: (r, note) => ({
      measured: `open at 150 s ${flag(r, "openAt150")}, heartbeat after ${flag(r, "delivered")}, hub evicted ${flag(r, "evicted")}`,
      verdict: flag(r, "openAt150") && flag(r, "delivered") ? "CONFIRMS" : "CONTRADICTS",
      note,
    }),
  },
  "R-HIB-5": silentRule("R-HIB-5"),
  "R-SIZE-1": sizeRule,
  "R-SIZE-2": sizeRule,
  "R-SIZE-3": {
    schema: { cap: { opt: "count" }, overCode: { opt: "code" } },
    sample: { cap: 33554432, overCode: 1009 },
    decide: (r, note) => {
      const cap = optNum(r, "cap")
      const over = optNum(r, "overCode")
      return {
        measured:
          cap === null
            ? `no transport refusal up to 64 MiB (largest tried); a 64 MiB message got ${over === null ? "no close in 20 s" : `close ${over}`}`
            : `max ${cap} B per WebSocket message; one byte more ends the socket (close ${over ?? "none"}, message too large)`,
        verdict: "NEW-EDGE",
        note,
      }
    },
  },
  "R-LIVE-5-1": {
    schema: CADENCE,
    sample: { lost: 0, p95: 180, maxGap: 5100, evicted: false },
    decide: (r, note) => {
      const p95 = optNum(r, "p95")
      return {
        measured: `lost ${num(r, "lost")}/12, p95 round trip ${p95 === null ? "-" : Math.round(p95)} ms, hub evicted ${flag(r, "evicted")}`,
        verdict:
          num(r, "lost") === 0 && p95 !== null && p95 < 5_000 && !flag(r, "evicted") ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
  "R-LIVE-5-2": {
    schema: WAKE,
    sample: wakeSample,
    decide: (r, note) => {
      const wake = optNum(r, "wake")
      return {
        measured: `hub evicted ${flag(r, "evicted")}, first round trip after wake ${msText(wake)}`,
        verdict: flag(r, "evicted") && wake !== null && wake < 5_000 ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
  "R-LIVE-15-1": {
    schema: WAKE,
    sample: wakeSample,
    decide: (r, note) => {
      const wake = optNum(r, "wake")
      return {
        measured: `hub evicted ${flag(r, "evicted")}, worst beat gap 5000 + ${msText(wake)}`,
        verdict: flag(r, "evicted") && wake !== null && 5_000 + wake < 15_000 ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
  "R-LIVE-15-2": {
    schema: CADENCE,
    sample: { lost: 0, p95: 180, maxGap: 5100, evicted: false },
    decide: (r, note) => {
      const gap = optNum(r, "maxGap")
      return {
        measured: `lost ${num(r, "lost")}/12, largest gap ${gap ?? "-"} ms`,
        verdict: num(r, "lost") === 0 && gap !== null && gap < 15_000 ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
  "R-LIVE-120-1": {
    schema: KEEPALIVE,
    sample: { openAt150: true, delivered: true, evicted: true },
    decide: (r, note) => ({
      measured: `open at 150 s ${flag(r, "openAt150")}, hub evicted ${flag(r, "evicted")}`,
      verdict: flag(r, "openAt150") && flag(r, "delivered") ? "CONFIRMS" : "CONTRADICTS",
      note,
    }),
  },
  "R-LIVE-120-2": silentRule("R-LIVE-120-2"),
  "L-STATE": {
    schema: {
      device_service: { oneOf: ["running"] },
      version: "text",
      target_visible: { oneOf: ["yes"] },
      control: { oneOf: ["ok"] },
      control_tool: { oneOf: ["nc", "bun"] },
      control_listeners: "count",
      control_off_loopback: "count",
      listeners_total: "count",
      listeners_off_loopback: "count",
      unix_sockets: "count",
      udp_discovery_sockets: "count",
      load: "ms",
      cores: "count",
    },
    sample: {
      device_service: "running",
      version: "0.1.0",
      target_visible: "yes",
      control: "ok",
      control_tool: "nc",
      control_listeners: 2,
      control_off_loopback: 1,
      listeners_total: 0,
      listeners_off_loopback: 0,
      unix_sockets: 23,
      udp_discovery_sockets: 0,
      load: 7.03,
      cores: 14,
    },
    decide: (r, note) => ({
      measured: `lsof control ok (${str(r, "control_tool")} listeners on loopback and all interfaces: ${num(r, "control_listeners")} seen, ${num(r, "control_off_loopback")} off loopback); device service ${str(r, "version")}; listeners ${num(r, "listeners_total")} (off loopback ${num(r, "listeners_off_loopback")}); unix sockets ${num(r, "unix_sockets")}; discovery sockets ${num(r, "udp_discovery_sockets")}; load ${num(r, "load")}/${num(r, "cores")}`,
      verdict:
        num(r, "listeners_off_loopback") === 0 && num(r, "udp_discovery_sockets") === 0 ? "CONTRADICTS" : "NEW-EDGE",
      note,
    }),
  },
  "R-HOSTED-1": {
    schema: {
      opened_ms: "ms",
      closed_after_open_ms: "ms",
      code: "code",
      ref_after_open_ms: "ms",
      ref_code: "code",
      deadline_ms: "ms",
    },
    sample: {
      opened_ms: 300,
      closed_after_open_ms: 9952,
      code: 4004,
      ref_after_open_ms: 10_050,
      ref_code: 4004,
      deadline_ms: 10_000,
    },
    decide: (r, note) => {
      const ms = num(r, "closed_after_open_ms")
      const deadline = num(r, "deadline_ms")
      const ok = ms >= deadline - 500 && ms <= deadline + 2_000 && num(r, "code") === num(r, "ref_code")
      return {
        measured: `hosted closed ${ms} ms after open, code ${num(r, "code")}; hello deadline ${deadline} ms; local relay (this run, loaded build host) closed ${num(r, "ref_after_open_ms")} ms after open, code ${num(r, "ref_code")}`,
        verdict: ok ? "CONFIRMS" : "CONTRADICTS",
        note,
      }
    },
  },
}
/** The one gate: a rule decides only a record whose every field its schema accepts; anything else is UNMEASURED. */
const judge = (rule: string, r: Rec, note: string): Run => {
  const found = RULES[rule]
  if (found === undefined) return failedRun(`no verdict rule named ${rule}`)
  const bad = invalidField(found, r)
  if (bad !== null)
    return failedRun(
      `${rule}: measurement field ${bad} is missing or invalid (${bad in r ? String(JSON.stringify(r[bad])) : "missing"})`,
    )
  return found.decide(r, note)
}
/** Helper output values are strings; a value that is wholly a number becomes one (anything else stays and fails). */
const fieldsRecord = (fields: Readonly<Record<string, string>>): Rec =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, /^\d+(\.\d+)?$/.test(v) ? Number(v) : v]))
type ReproveQa = Readonly<{
  before: { hibernated: number; reconnectsPerRefresh: number }
  after: { hibernated: number; reconnectsPerRefresh: number; reproveMs: number[] }
}>
/** R-AUTH-4 (re-proof client) and R-AUTH-5 (client without re-proof) from the relay's own re-proof QA. */
const reproveRun = (m: ReproveQa | null, client: "reprove" | "legacy", note: string): Run => {
  if (m === null) return failedRun("the relay checkout's re-proof QA reported nothing")
  return client === "reprove" ? judge("R-AUTH-4", { ...m.after }, note) : judge("R-AUTH-5", { ...m.before }, note)
}
type Silent = Readonly<{ openAt150: boolean; closedAfterS: number | null; closeCode: number | null; evicted: boolean }>
/** R-HIB-5 (how long a silent channel lives) and R-LIVE-120-2 (does it outlive 120 s): only the dead-window close counts. */
const silentRun = (m: Silent, row: "R-HIB-5" | "R-LIVE-120-2", note: string): Run => judge(row, m, note)
/** L-STATE-*: the pair helper's state fields for one host, through the gate. */
const stateRun = (m: PairOut, note: string): Run =>
  m.ok ? judge("L-STATE", fieldsRecord(m.fields), note) : failedRun(m.why)
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
/** R-HOSTED-1-*: the hosted silent unadmitted socket against the relay's hello deadline and the local relay's close. */
const hostedRun = (m: PairOut, ref: { afterOpenMs: number; code: string }, deadlineMs: number, note: string): Run => {
  if (!m.ok) return failedRun(m.why)
  const f = fieldsRecord(m.fields)
  const refCode = fieldsRecord({ c: ref.code })["c"]
  return judge(
    "R-HOSTED-1",
    {
      opened_ms: f["opened_ms"],
      closed_after_open_ms: f["closed_after_open_ms"],
      code: f["code"],
      ref_after_open_ms: ref.afterOpenMs,
      ref_code: refCode,
      deadline_ms: deadlineMs,
    },
    note,
  )
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
  // The complete helper record, minus the two control fields each case sets (or leaves out) itself.
  const base = {
    ok: true,
    fields: Object.fromEntries(
      Object.entries(RULES["L-STATE"]?.sample ?? {})
        .filter(([k]) => k !== "control" && k !== "target_visible")
        .map(([k, v]) => [k, String(v)]),
    ),
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
  // Round 2, finding 1-2 (class): ONE gate. Every rule's valid sample decides; every mutation of every field of every
  // record (missing, NaN, negative, placeholder string, wrong type; empty list for lists) is UNMEASURED naming the field.
  const wrongType = (k: Kind): unknown => (k === "bool" ? 1 : true)
  // A rule that throws on a bad record is the defect this gate exists for; count it as a failure, never a crash.
  const tryJudge = (name: string, rec: Rec): Run => {
    try {
      return judge(name, rec, "n")
    } catch (e) {
      return { measured: `threw: ${e instanceof Error ? e.message : String(e)}`, verdict: "CONTRADICTS", note: "" }
    }
  }
  for (const [name, rule] of Object.entries(RULES)) {
    const ok = judge(name, rule.sample, "n")
    check(
      `R2 ${name}: its valid sample is decided`,
      ok.errored !== true && ok.verdict !== "UNMEASURED",
      JSON.stringify(ok),
    )
    for (const [field, kind] of Object.entries(rule.schema)) {
      const mutations: (readonly [string, unknown])[] = [
        ["NaN", Number.NaN],
        ["negative", -1],
        ["placeholder", "?"],
        ["wrong type", wrongType(kind)],
      ]
      if (typeof kind === "object" && "list" in kind) mutations.push(["empty list", []], ["list of NaN", [Number.NaN]])
      const missing = { ...rule.sample }
      delete (missing as Record<string, unknown>)[field]
      const cases: (readonly [string, Rec])[] = [
        ["missing", missing],
        ...mutations.map(([m, v]) => [m, { ...rule.sample, [field]: v }] as const),
      ]
      for (const [m, rec] of cases) {
        const r = tryJudge(name, rec)
        check(`R2 ${name}.${field} ${m} -> UNMEASURED`, failed(r) && r.note.includes(field), JSON.stringify(r))
      }
    }
  }
  check("R2 an unknown rule name is UNMEASURED", failed(judge("R-NOPE", {}, "n")))
  for (const id of ["R-AUTH-1", "R-AUTH-2"]) {
    const early = judge(id, { afterExpS: 3, closedEarly: true, code: 4003, evicted: id === "R-AUTH-2" }, "n")
    check(
      `R2 ${id} a close before token expiry stays a measured CONTRADICTS`,
      early.verdict === "CONTRADICTS" && early.errored !== true && early.measured.includes("before exp"),
      JSON.stringify(early),
    )
  }
  // Finding 1 through hostedRun itself: the local reference and the deadline are part of the record.
  const goodPair: PairOut = {
    ok: true,
    fields: { load: "1", opened_ms: "300", closed_after_open_ms: "9952", code: "4004" },
  }
  const refs: readonly (readonly [string, { afterOpenMs: number; code: string }, number])[] = [
    ["local reference timed out (review case)", { afterOpenMs: -1, code: "open_at_90s" }, 10_000],
    ["hello deadline missing from the checkout (review case)", { afterOpenMs: 10_050, code: "4004" }, Number.NaN],
    ["local code not a number", { afterOpenMs: 10_050, code: "closed" }, 10_000],
    ["local time NaN", { afterOpenMs: Number.NaN, code: "4004" }, 10_000],
    ["deadline negative", { afterOpenMs: 10_050, code: "4004" }, -1],
    ["deadline infinite", { afterOpenMs: 10_050, code: "4004" }, Number.POSITIVE_INFINITY],
  ]
  for (const [name, ref, deadline] of refs)
    check(
      `R2 hostedRun ${name} -> UNMEASURED`,
      failed(hostedRun(goodPair, ref, deadline, "n")),
      JSON.stringify(hostedRun(goodPair, ref, deadline, "n")),
    )
  check(
    "R2 hostedRun valid record -> CONFIRMS",
    hostedRun(goodPair, { afterOpenMs: 10_050, code: "4004" }, 10_000, "n").verdict === "CONFIRMS",
  )
  for (const field of ["opened_ms", "closed_after_open_ms", "code"]) {
    const fields: Record<string, string> = { ...goodPair.fields }
    delete fields[field]
    check(
      `R2 hostedRun helper field ${field} missing -> UNMEASURED`,
      failed(hostedRun({ ok: true, fields }, { afterOpenMs: 10_050, code: "4004" }, 10_000, "n")),
    )
  }
  // Finding 2 through stateRun itself: every helper field, deleted or set to a placeholder, is UNMEASURED.
  for (const field of Object.keys(RULES["L-STATE"]?.schema ?? {})) {
    for (const [m, v] of [
      ["missing", undefined],
      ["placeholder", "?"],
      ["negative", "-1"],
    ] as const) {
      const fields: Record<string, string> = { ...base.fields, control: "ok", target_visible: "yes" }
      if (v === undefined) delete fields[field]
      else fields[field] = v
      check(
        `R2 stateRun ${field} ${m} -> UNMEASURED`,
        failed(stateRun({ ok: true, fields }, "n")),
        JSON.stringify(stateRun({ ok: true, fields }, "n")),
      )
    }
  }
  // Static (class): every measured row reaches the gate, and the gate's wrappers call judge().
  const source = readFileSync(join(import.meta.dir, "probe-sp-r.ts"), "utf8")
  // Section headers start a line; the same words inside this test are indented string literals and never match.
  const header = (name: string): number => source.search(new RegExp(`^// ---- ${name}`, "m"))
  const rowsSrc = source.slice(header("the rows"), header("run"))
  const rowBodies = rowsSrc.split(/\n  row\(|\nconst stateSpec|\nconst silentSpec|\n  \{\n    id: /).slice(1)
  // 20 relay rows, the two pair-row factories and R-HOSTED-2 are built in that section (the same-network rows are
  // constants from one map); a scan that finds fewer proves nothing.
  check("R2 row scan found every row", rowBodies.length >= 23, `found ${rowBodies.length}`)
  for (const body of rowBodies) {
    const id = /"([A-Z]-[A-Z0-9-]+)"/.exec(body)?.[1] ?? (body.startsWith(" = ") ? "spec" : body.slice(0, 30))
    check(
      `R2 row ${id} reaches the gate`,
      /judge\(|silentRun\(|reproveRun\(|stateRun\(|hostedRun\(|verdict: "UNMEASURED"/.test(body),
      body.slice(0, 120),
    )
  }
  for (const w of ["reproveRun", "silentRun", "stateRun", "hostedRun"]) {
    const at = source.indexOf(`const ${w} = `)
    const body = source.slice(at, source.indexOf("\n}", at) + 2)
    check(`R2 ${w} decides through judge()`, at >= 0 && body.includes("judge("), body.slice(0, 120))
  }
  // Finding 4 static (class): every socket open or peer connect in the measurement code sits in a bounded wait.
  const measureFrom = header("the relay harness")
  const lines = source.slice(measureFrom).split("\n")
  const base0 = source.slice(0, measureFrom).split("\n").length
  let opens = 0
  lines.forEach((line, i) => {
    if (
      !/openSocket\(|new WebSocket\(|\.connect\(\)/.test(line) ||
      /^\s*(\/\/|\*)/.test(line) ||
      /=> PeerT|connect\(\): Promise/.test(line)
    )
      return
    opens += 1
    const near = lines.slice(i, i + 3).join("\n")
    check(`R2 bounded open at line ${base0 + i}`, /within\(/.test(line) || /awaitOpen\(/.test(near), line.trim())
  })
  // Four socket opens and two peer-connect sites exist in the measurement code; a scan that finds fewer proves nothing.
  check("R2 bounded-open scan found every open and connect", opens >= 6, `found ${opens}`)
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
const roundTrip = async (p: { brain: PeerT }, n: number, timeoutMs = 15_000): Promise<number | null> => {
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
  const r = await within(timeoutMs, back)
  return r === "timeout" ? null : r
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
      if (r === null) lost += 1
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
      p95: sorted.length === 0 ? null : (sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? null),
      maxGap: gaps.length === 0 ? null : Math.max(...gaps),
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
    const delivered = end === "timeout" ? (await roundTrip(p, 2)) !== null : false
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
      if (p.brain.ws?.readyState !== WebSocket.OPEN && (await within(15_000, p.brain.connect())) === "timeout")
        throw new Error("relay peer did not reconnect within 15 s")
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
    const closeFor = async (n: number): Promise<number | null> => {
      const ws = h.openSocket(socketUrl(base, uid("sp-r-raw"), "hand"))
      await awaitOpen(ws)
      const closed = new Promise<{ at: number; code: number }>((done) => {
        ws.addEventListener("close", (e) => done({ at: Date.now(), code: e.code }), { once: true })
      })
      ws.send(new Uint8Array(n))
      const end = await within(20_000, closed)
      if (end === "timeout") ws.close()
      return end === "timeout" ? null : end.code
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
      afterExpS: end === "timeout" ? null : Math.abs(Math.round((end.at - expS * 1000) / 100) / 10),
      closedEarly: end !== "timeout" && end.at < expS * 1000 - 50,
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
const relayNote = "local relay (workerd via wrangler dev --local), test credentials minted by the probe"

const row = (id: string, question: string, run: () => Promise<Run>): Spec => ({ id, pipe: "relay", question, run })
const relay: Spec[] = [
  row(
    "R-AUTH-1",
    "auth lifetime, awake hub: an admitted channel whose token is never refreshed closes at token expiry (no channel outlives its auth)",
    async () => judge("R-AUTH-1", await mExpiry(false), relayNote),
  ),
  row(
    "R-AUTH-2",
    "auth lifetime across one hub hibernation: the expiry still closes the channel when the hub was evicted before it",
    async () => judge("R-AUTH-2", await mExpiry(true), `${relayNote}; condition holds only when hub evicted is true`),
  ),
  row(
    "R-AUTH-3",
    "auth lifetime at dial: a token already expired is refused before the channel is admitted",
    async () => judge("R-AUTH-3", await mExpiredHello(), relayNote),
  ),
  row(
    "R-AUTH-4",
    "unattended refresh after one hub hibernation, client advertising in-band re-proof: the channel stays up (0 reconnects)",
    async () =>
      reproveRun(
        await mRefresh(),
        "reprove",
        `${relayNote}; measured by the relay checkout's own hibernation re-proof QA, 1 run`,
      ),
  ),
  row("R-AUTH-5", "refresh after one hub hibernation, client without in-band re-proof: what the relay does", async () =>
    reproveRun(
      await mRefresh(),
      "legacy",
      `${relayNote}; the hand's relay client must advertise re-proof or reconnect once per refresh after a hibernation`,
    ),
  ),
  row("R-AUTH-6", "token lifetime the account service issues, and the relay's cap on one token's window", () =>
    Promise.resolve({ measured: "-", verdict: "UNMEASURED", note: "needs a test account" }),
  ),
  row(
    "R-HIB-1",
    "hub hibernation onset: idle time after which the hub is evicted while both channels stay open (5 s transport keepalive)",
    async () => {
      const m = await mEvict()
      return judge(
        "R-HIB-1",
        {
          sweep: m.res.map((r) => `${r.s}s:${r.evicted ? "evicted" : "resident"}`).join(" "),
          firstEvicted: m.firstEvicted,
          allOpen: m.allOpen,
        },
        `${relayNote}; hub keeps no process state across hibernation and the channels survive it; onset is the local runtime's, not the hosted one's`,
      )
    },
  ),
  row(
    "R-HIB-2",
    "does the durable channel survive one hub hibernation: same sockets, heartbeat round trip after the wake",
    async () => judge("R-HIB-2", await mWake(), relayNote),
  ),
  row(
    "R-HIB-3",
    "a command sent right after one hub hibernation is delivered (nothing lost across the wake)",
    async () => judge("R-HIB-3", await mWake(), relayNote),
  ),
  row(
    "R-HIB-4",
    "for how long a hibernated channel lives with the 5 s transport keepalive (observed to 150 s)",
    async () => judge("R-HIB-4", await mSurvive(false), relayNote),
  ),
  row("R-HIB-5", "for how long a hibernated channel lives with no traffic at all (silent peer)", async () =>
    silentRun(await mSurvive(true), "R-HIB-5", `${relayNote}; relay dead window left at its shipped 60,000 ms`),
  ),
  row(
    "R-SIZE-1",
    "message-size limit, stream class: largest sealed payload admitted, and the refusal one byte over",
    async () =>
      judge("R-SIZE-1", await mSize("stream"), `${relayNote}; frames above the cap need an off-channel artifact path`),
  ),
  row(
    "R-SIZE-3",
    "message-size limit at the transport: largest single WebSocket message the relay runtime accepts before parsing it",
    async () =>
      judge(
        "R-SIZE-3",
        await mTransport(),
        `${relayNote}; unadmitted socket, raw bytes; local runtime only, the hosted runtime message cap is not measured here; every relayed message is held to the codec cap of R-SIZE-1/2`,
      ),
  ),
  row(
    "R-SIZE-2",
    "message-size limit, data (stored command) class: largest sealed payload admitted, and the refusal one byte over",
    async () => judge("R-SIZE-2", await mSize("data"), relayNote),
  ),
  row(
    "R-LIVE-5-1",
    "5 s heartbeat, no hibernation in reach: 12 beats at 5 s all answered within 5 s, hub never evicted",
    async () =>
      judge(
        "R-LIVE-5-1",
        await mCadence(false),
        `${relayNote}; a 5 s heartbeat keeps the hub resident (see R-HIB-1 onset)`,
      ),
  ),
  row(
    "R-LIVE-5-2",
    "5 s window across one hibernation: the first heartbeat after a wake is answered within 5 s",
    async () => judge("R-LIVE-5-2", await mWake(), relayNote),
  ),
  row(
    "R-LIVE-15-1",
    "15 s window across one hibernation: 5 s cadence plus the wake round trip stays under 15 s",
    async () => judge("R-LIVE-15-1", await mWake(), relayNote),
  ),
  row(
    "R-LIVE-15-2",
    "15 s window with a hibernation wake (state loss) injected mid-run under the 5 s cadence: largest gap between answered beats",
    async () =>
      judge(
        "R-LIVE-15-2",
        await mCadence(true),
        `${relayNote}; the wake is the relay's own test hook (hibernation-wake memory, sockets kept)`,
      ),
  ),
  row(
    "R-LIVE-120-1",
    "120 s window across hibernation with the 5 s transport keepalive: the channel outlives 120 s",
    async () => judge("R-LIVE-120-1", await mSurvive(false), relayNote),
  ),
  row("R-LIVE-120-2", "120 s window across hibernation with a silent peer: the channel outlives 120 s", async () =>
    silentRun(
      await mSurvive(true),
      "R-LIVE-120-2",
      `${relayNote}; design question for the lead, see the row's finding R-LIVE-120-2 in the task evidence; R4's 120 s deadline is unchanged until the lead rules`,
    ),
  ),
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
