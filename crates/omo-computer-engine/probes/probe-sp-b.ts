#!/usr/bin/env bun
// Spike SP-B: bunshin hosting gaps. Measures each ledger row on this host and either writes the
// ledger (--write) or re-measures every row and compares the verdict column (--verify).
//
// Measurements run only against a local bunshin binary under a fresh, empty HOME; they never
// contact a running agent, a hub or another machine. Rows whose proof is bunshin source read a
// local check file kept outside the repository (see README.md).
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import os from "node:os"
import path from "node:path"

type Verdict = "closed" | "open-with-row" | "needs-installer" | "UNMEASURED" | "CONTRADICTS" | "CHANGED"
// notRun: the row needs an opt-in this run did not give (the root leg without --allow-sudo).
type Measured = { verdict: Verdict; measured: string; detail?: unknown; notRun?: true }
type Row = {
  id: string
  gap: string
  condition: string
  owner: string
  rootLeg?: true
  source?: true
  measure: (ctx: Ctx) => Promise<Measured>
}
type SourceCheck = { kind: "present" | "absent"; pattern: string; paths: string[] }
// The local file carries only the search patterns; each row's expected verdict lives in this script.
type SourceSpec = { bunshinSrc: string; rows: Record<string, { checks: SourceCheck[] }> }
type Ctx = { bin: string; home: string; spec: SourceSpec; specPath: string; allowSudo: boolean }

const LEDGER_HEADER = ["id", "gap", "condition", "measured", "verdict", "rerun", "host_build", "owner", "evidence"]
const SCRIPT = "crates/omo-computer-engine/probes/probe-sp-b.ts"
const HELPER = path.join(import.meta.dir, "probe-sp-b-root-watch.sh")

// A precondition found during a measurement: thrown so the caller's finally still cleans up, then
// reported by main as one exit-2 line.
class PreconditionError extends Error {}

const fail = (line: string, code = 2): never => {
  process.stderr.write(`${line}\n`)
  process.exit(code)
}

const run = async (cmd: string[], env?: Record<string, string>) => {
  const proc = Bun.spawn(cmd, env ? { stdout: "pipe", stderr: "pipe", env } : { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

const bunshin = async (ctx: Ctx, args: string[]) => {
  const env = { PATH: "/usr/bin:/bin", HOME: ctx.home, BUNSHIN_HOME: path.join(ctx.home, ".bunshin") }
  const result = await run([ctx.bin, ...args], env)
  if (result.code !== 0) throw new Error(`bunshin ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`)
  return result.stdout
}

type RegistryOp = { op: string; effect: string; variableFields?: string[] }
type Registry = { ops: RegistryOp[]; capabilityGroups: Record<string, string[]> }
const registry = async (ctx: Ctx): Promise<Registry> => JSON.parse(await bunshin(ctx, ["schema"]))

const descriptor = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  kind: "sidecar",
  version: "0.1.0",
  description: "sp-b probe",
  schema: { type: "object" },
  ops: [`${name}.op`],
  sidecar: { executable: "/bin/true", args: [], protocol: "json-rpc-stdio", timeoutMs: 1000 },
  sandbox: { grant: "full_access" },
  ...extra,
})

type ManifestEntry = Record<string, unknown> & { name: string; transport: string }
const manifestWith = async (ctx: Ctx, name: string, desc: unknown) => {
  const dir = path.join(ctx.home, `caps-${name}`)
  await Bun.write(path.join(dir, `${name}.json`), JSON.stringify(desc))
  const manifest = JSON.parse(
    await bunshin(ctx, ["manifest", "--machine-id", "sp-b-probe", "--capabilities-dir", dir]),
  ) as { capabilities: ManifestEntry[] }
  return manifest.capabilities.find((entry) => entry.name === name)
}

const sourceRow = async (ctx: Ctx, id: string, expect: Verdict): Promise<Measured> => {
  const row = ctx.spec.rows[id]
  // loadSpec already refused a file without this entry; reaching here without it is a bug, not a finding.
  if (!row) throw new Error(`source-check entry ${id} vanished after validation`)
  const results = []
  for (const check of row.checks) {
    const r = await run(["git", "-C", ctx.spec.bunshinSrc, "grep", "-nE", check.pattern, "--", ...check.paths])
    if (r.code > 1) throw new Error(`git grep failed (${r.code}): ${r.stderr.trim()}`)
    const hits = r.stdout.split("\n").filter(Boolean)
    results.push({ ...check, hits: hits.length, ok: check.kind === "present" ? hits.length > 0 : hits.length === 0 })
  }
  const okCount = results.filter((r) => r.ok).length
  const verdict = okCount === results.length ? expect : "CHANGED"
  return { verdict, measured: `${okCount}/${results.length} local source checks hold`, detail: results }
}

const unmeasured =
  (reason: string, needs: (ctx: Ctx) => boolean) =>
  async (ctx: Ctx): Promise<Measured> =>
    needs(ctx)
      ? { verdict: "CHANGED", measured: `precondition now present on this host; measure it: ${reason}` }
      : { verdict: "UNMEASURED", measured: reason }

const onMac = () => process.platform === "darwin"
const onWindows = () => process.platform === "win32"

type RootLeg = {
  mode: string
  pdeathsigAfterDrop: number
  hostWatch: string
  launcherEnded: string
  launcherGoneMs: number
  engineGoneMs: number
  residualPids: number[]
}
// The helper exits 3 when python3 is missing; that is a precondition, never a measurement.
const ROOT_HELPER_NO_PYTHON = 3
const ROOT_HELPER_NOT_READY = 4
const ROOT_HELPER_NO_PIDFD = 5

const parseRootLeg = (stdout: string): RootLeg | undefined => {
  const last = stdout.trim().split("\n").at(-1) ?? ""
  if (!last) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(last)
  } catch {
    return undefined
  }
  if (typeof raw !== "object" || raw === null) return undefined
  const o: Record<string, unknown> = { ...raw }
  const nums = ["pdeathsigAfterDrop", "launcherGoneMs", "engineGoneMs"]
  const strs = ["mode", "hostWatch", "launcherEnded"]
  if (!nums.every((k) => typeof o[k] === "number") || !strs.every((k) => typeof o[k] === "string")) return undefined
  if (!Array.isArray(o.residualPids)) return undefined
  return {
    mode: String(o.mode),
    pdeathsigAfterDrop: Number(o.pdeathsigAfterDrop),
    hostWatch: String(o.hostWatch),
    launcherEnded: String(o.launcherEnded),
    launcherGoneMs: Number(o.launcherGoneMs),
    engineGoneMs: Number(o.engineGoneMs),
    residualPids: o.residualPids.map(Number),
  }
}

// One stand-in leg as root. "pidfd" proves the pidfd watch alone (the launcher must end by its own
// exit 137); "pdeathsig" proves the re-armed parent-death signal alone (the launcher must end by SIGKILL).
const rootLeg = async (ctx: Ctx, mode: "pidfd" | "pdeathsig"): Promise<Measured> => {
  if (!ctx.allowSudo)
    return { verdict: "UNMEASURED", measured: "root leg not run: pass --allow-sudo to measure it", notRun: true }
  const uid = String(process.getuid?.() ?? 1000)
  const gid = String(process.getgid?.() ?? 1000)
  const r = await run(["sudo", "-n", "/bin/sh", HELPER, uid, gid, mode])
  if (r.code === ROOT_HELPER_NO_PYTHON)
    throw new PreconditionError("SP-B precondition missing: python3 not found for the root leg")
  // Only a parsed report can contradict. Any helper failure is no measurement, reported with its code and stderr.
  if (r.code !== 0) {
    const kind =
      r.code === ROOT_HELPER_NOT_READY
        ? "stand-in never reported ready"
        : r.code === ROOT_HELPER_NO_PIDFD
          ? "pidfd_open unavailable to the helper"
          : "helper failed"
    return { verdict: "UNMEASURED", measured: `${kind} (exited ${r.code}); stderr: ${r.stderr.trim() || "<empty>"}` }
  }
  const d = parseRootLeg(r.stdout)
  // No parseable report is no measurement: say so with the helper's stderr, never a verdict built on a default.
  if (!d)
    return {
      verdict: "UNMEASURED",
      measured: `root leg gave no parseable report (stdout ${JSON.stringify(r.stdout.trim().slice(0, 80))}); stderr: ${r.stderr.trim() || "<empty>"}`,
    }
  if (d.mode !== mode)
    return {
      verdict: "UNMEASURED",
      measured: `helper reported mode ${d.mode} for the ${mode} leg; not a measurement of this leg`,
    }
  if (mode === "pidfd" && d.hostWatch !== "pidfd")
    return { verdict: "UNMEASURED", measured: `pidfd_open unavailable in the launcher (hostWatch ${d.hostWatch})` }
  const wantEnd = mode === "pidfd" ? "exit 137" : "signal 9"
  const ok =
    d.pdeathsigAfterDrop === 0 &&
    d.launcherEnded === wantEnd &&
    d.launcherGoneMs >= 0 &&
    d.launcherGoneMs <= 2000 &&
    d.engineGoneMs >= 0 &&
    d.engineGoneMs <= 2000 &&
    d.residualPids.length === 0
  const watch = mode === "pidfd" ? `pidfd watch (${d.hostWatch})` : "re-armed PDEATHSIG"
  return {
    verdict: ok ? "open-with-row" : "CONTRADICTS",
    measured: `PR_GET_PDEATHSIG after drop=${d.pdeathsigAfterDrop}; mechanism ${watch}: launcher ended by ${d.launcherEnded} in ${d.launcherGoneMs} ms, engine gone in ${d.engineGoneMs} ms after kill -9 of the stand-in agent; residual pids ${d.residualPids.length}`,
    detail: d,
  }
}

const rows: Row[] = [
  {
    id: "B-01a",
    gap: "persistent session",
    condition: "sidecar descriptor asking for a long-lived protocol",
    owner: "row 64",
    measure: async (ctx) => {
      const control = await manifestWith(ctx, "spbctl", descriptor("spbctl"))
      const persistent = await manifestWith(
        ctx,
        "spbpersist",
        descriptor("spbpersist", {
          sidecar: { executable: "/bin/true", args: [], protocol: "persistent-stdio", timeoutMs: 1000 },
        }),
      )
      if (!control) return { verdict: "CONTRADICTS", measured: "control descriptor was not advertised" }
      return persistent
        ? { verdict: "closed", measured: "a long-lived sidecar protocol is advertised" }
        : { verdict: "open-with-row", measured: "control advertised; long-lived protocol descriptor not advertised" }
    },
  },
  {
    id: "B-01b",
    gap: "persistent session",
    condition: "sidecar process lifetime per call (source)",
    owner: "row 64",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-01b", "open-with-row"),
  },
  {
    id: "B-02a",
    gap: "input tier",
    condition: "effect classes of the op registry",
    owner: "row 64",
    measure: async (ctx) => {
      const effects = [...new Set((await registry(ctx)).ops.map((op) => op.effect))].sort()
      const hasInput = effects.some((e) => e !== "read" && e !== "mutate")
      return {
        verdict: hasInput ? "closed" : "open-with-row",
        measured: `effect classes: ${effects.join(",")}`,
      }
    },
  },
  {
    id: "B-02b",
    gap: "input tier",
    condition: "sidecar descriptor declaring an input effect",
    owner: "row 64",
    measure: async (ctx) => {
      const read = await manifestWith(ctx, "spbread", descriptor("spbread", { effects: { "spbread.op": "read" } }))
      const input = await manifestWith(ctx, "spbinput", descriptor("spbinput", { effects: { "spbinput.op": "input" } }))
      if (!read) return { verdict: "CONTRADICTS", measured: "read-effect control was not advertised" }
      return input
        ? { verdict: "closed", measured: "input-effect descriptor advertised" }
        : { verdict: "open-with-row", measured: "read-effect advertised; input-effect descriptor rejected" }
    },
  },
  {
    id: "B-03",
    gap: "fleet stop/resume",
    condition: "stop, suspend or resume verb in the op registry",
    owner: "row 67",
    measure: async (ctx) => {
      const reg = await registry(ctx)
      const verbs = reg.ops.map((op) => op.op).filter((op) => /stop|suspend|resume|latch/i.test(op))
      return verbs.length
        ? { verdict: "closed", measured: `stop verbs: ${verbs.join(",")}` }
        : { verdict: "open-with-row", measured: `0 stop/suspend/resume verbs among ${reg.ops.length} ops` }
    },
  },
  {
    id: "B-04a",
    gap: "image artifact type",
    condition: "media type on the artifact ops",
    owner: "row 63",
    measure: async (ctx) => {
      const ops = (await registry(ctx)).ops.filter((op) => op.op.startsWith("artifact."))
      const typed = ops.filter((op) => (op.variableFields ?? []).some((f) => /mime|media|content.?type/i.test(f)))
      return typed.length
        ? { verdict: "closed", measured: `typed artifact ops: ${typed.map((o) => o.op).join(",")}` }
        : { verdict: "open-with-row", measured: `${ops.length} artifact ops, none carries a media type` }
    },
  },
  {
    id: "B-04b",
    gap: "image artifact type",
    condition: "artifact reference field set (source)",
    owner: "row 63",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-04b", "open-with-row"),
  },
  {
    id: "B-05a",
    gap: "root agent without a display",
    condition: "installer offers a root system service",
    owner: "row 62",
    measure: async (ctx) => {
      const help = await bunshin(ctx, ["machine", "add", "--help"])
      return /systemd-system/.test(help)
        ? { verdict: "open-with-row", measured: "a root system-service install is offered" }
        : { verdict: "CHANGED", measured: "no root system-service install offered" }
    },
  },
  {
    id: "B-05b",
    gap: "root agent without a display",
    condition: "graphical session environment import (source)",
    owner: "row 62",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-05b", "open-with-row"),
  },
  {
    id: "B-05c",
    gap: "root agent without a display",
    condition:
      "stand-in launcher (no bunshin): host-death watch through the pidfd alone, PDEATHSIG cleared by the uid drop and not re-armed",
    owner: "row 62",
    rootLeg: true,
    measure: (ctx) => rootLeg(ctx, "pidfd"),
  },
  {
    id: "B-05d",
    gap: "root agent without a display",
    condition:
      "live root-agent row with the real launcher (PDEATHSIG 0, hostWatch pidfd, 0 launcher and 0 engine pids 2 s after kill -9)",
    owner: "row 62",
    measure: unmeasured("no launcher binary exists before row 62; diagnose().hostWatch is not built", () => false),
  },
  {
    id: "B-05e",
    gap: "root agent without a display",
    condition:
      "stand-in launcher (no bunshin): host-death through PDEATHSIG re-armed after the uid drop, no pidfd poll",
    owner: "row 62",
    rootLeg: true,
    measure: (ctx) => rootLeg(ctx, "pdeathsig"),
  },
  {
    id: "B-06a",
    gap: "no Windows service",
    condition: "service managers the installer offers",
    owner: "row 64 prerequisite",
    measure: async (ctx) => {
      const help = await bunshin(ctx, ["machine", "add", "--help"])
      const values = /--service <SERVICE>.*\[possible values: ([^\]]+)\]/.exec(help)?.[1] ?? ""
      const windows = /windows|schtasks|onlogon|winsw|nssm|service-control/i.test(values)
      return windows
        ? { verdict: "closed", measured: `service managers: ${values}` }
        : { verdict: "needs-installer", measured: `service managers: ${values}; none for Windows` }
    },
  },
  {
    id: "B-06b",
    gap: "no Windows service",
    condition: "agent as a service or in Session 0 answers attach-only",
    owner: "host H6",
    measure: unmeasured("needs the Windows desktop of host H6", onWindows),
  },
  {
    id: "B-07a",
    gap: "TCC on the agent",
    condition: "responsible process for the agent's own permission checks (source)",
    owner: "row 62",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-07a", "open-with-row"),
  },
  {
    id: "B-07b",
    gap: "TCC on the agent",
    condition: "macOS launchd domain the agent runs in (launchctl print gui/<uid>)",
    owner: "host H1",
    measure: unmeasured("needs a macOS graphical session (host H1)", onMac),
  },
  {
    id: "B-07c",
    gap: "TCC on the agent",
    condition: "macOS installer domain choice when no GUI domain exists (source)",
    owner: "row 64 prerequisite",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-07c", "needs-installer"),
  },
  {
    id: "B-07d",
    gap: "TCC on the agent",
    condition: "ssh bridge launchctl bootstrap gui/<uid> from an ssh child while the user holds the console",
    owner: "host H1",
    measure: unmeasured("needs a macOS graphical session with the user at the console (host H1)", onMac),
  },
  {
    id: "B-07e",
    gap: "TCC on the agent",
    condition: "process tccd charges for a helper the agent spawns",
    owner: "host H1",
    measure: unmeasured("needs macOS hosts H1/H3; SP-T (row 9) owns the measurement", onMac),
  },
  {
    id: "B-08a",
    gap: "capability advert",
    condition: "sidecar op names reach the advertised manifest",
    owner: "-",
    measure: async (ctx) => {
      const entry = await manifestWith(ctx, "spbadvert", descriptor("spbadvert"))
      return entry && entry.transport === "sidecar"
        ? { verdict: "closed", measured: "sidecar ops advertised with transport sidecar" }
        : { verdict: "CHANGED", measured: "sidecar ops not advertised" }
    },
  },
  {
    id: "B-08b",
    gap: "capability advert",
    condition: "consent, permission, budget or stop-path state in the advert",
    owner: "row 66",
    measure: async (ctx) => {
      const entry = await manifestWith(ctx, "spbstate", descriptor("spbstate"))
      const keys = Object.keys(entry ?? {}).sort()
      const state = keys.filter((k) => /consent|permission|budget|stop/i.test(k))
      return state.length
        ? { verdict: "closed", measured: `state fields: ${state.join(",")}` }
        : { verdict: "open-with-row", measured: `${keys.length} entry fields, none carries hand state` }
    },
  },
  {
    id: "B-08c",
    gap: "capability advert",
    condition: "advert refreshed while connected (source)",
    owner: "-",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-08c", "closed"),
  },
  {
    id: "B-09",
    gap: "sidecar audit",
    condition: "per-call audit record on the sidecar path (source)",
    owner: "row 64",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-09", "open-with-row"),
  },
  {
    id: "B-10a",
    gap: "MCP",
    condition: "MCP capability in the op registry or built-in manifest",
    owner: "row 64",
    measure: async (ctx) => {
      const reg = await registry(ctx)
      const dir = path.join(ctx.home, "caps-empty")
      await Bun.write(path.join(dir, ".keep"), "")
      const manifest = JSON.parse(
        await bunshin(ctx, ["manifest", "--machine-id", "sp-b-probe", "--capabilities-dir", dir]),
      ) as { capabilities: ManifestEntry[] }
      const names = [
        ...reg.ops.map((op) => op.op),
        ...Object.keys(reg.capabilityGroups),
        ...manifest.capabilities.map((entry) => entry.name),
      ]
      return names.some((n) => /mcp/i.test(n))
        ? { verdict: "closed", measured: "an MCP capability is registered" }
        : { verdict: "open-with-row", measured: `0 MCP entries among ${names.length} ops, groups and built-ins` }
    },
  },
  {
    id: "B-10b",
    gap: "MCP",
    condition: "MCP anywhere in the tracked source (source)",
    owner: "row 64",
    source: true,
    measure: (ctx) => sourceRow(ctx, "B-10b", "open-with-row"),
  },
]

const hostBuild = () => `${os.type().toLowerCase()} ${os.release()} ${os.arch()}`

const parseLedger = (text: string) => {
  const lines = text.split("\n").filter((l) => l.length > 0)
  if (lines[0] !== LEDGER_HEADER.join("\t"))
    fail(`SP-B ledger malformed: line 1 is not the header ${LEDGER_HEADER.join(",")}`, 1)
  const map = new Map<string, { verdict: string; line: string }>()
  lines.slice(1).forEach((line, i) => {
    const cols = line.split("\t")
    if (cols.length !== LEDGER_HEADER.length || !cols[4] || !cols[5])
      fail(`SP-B ledger malformed: line ${i + 2} has ${cols.length} columns or an empty verdict/rerun`, 1)
    map.set(cols[0] ?? "", { verdict: cols[4] ?? "", line })
  })
  return map
}

const ledgerLine = (r: Row & Measured) =>
  [
    r.id,
    r.gap,
    r.condition,
    r.measured,
    r.verdict,
    `bun ${SCRIPT} --row ${r.id}${r.rootLeg ? " --allow-sudo" : ""}`,
    hostBuild(),
    r.owner,
    `$EV/task-11.bunshin-proof.txt#${r.id}`,
  ].join("\t")

// --write rewrites the whole ledger; --write with --row replaces (or adds) that one row, keeping the rest
// and the row order of this script.
// A row this run did not measure (the root leg without --allow-sudo) keeps its committed line.
const writeLedger = async (
  file: string,
  results: Array<Row & Measured>,
  existing: Map<string, { verdict: string; line: string }>,
) => {
  const kept = new Map(existing)
  for (const r of results)
    if (!(r.notRun && kept.has(r.id))) kept.set(r.id, { verdict: r.verdict, line: ledgerLine(r) })
  const order = rows.map((r) => r.id)
  const ids = [...kept.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const body = ids.map((id) => kept.get(id)?.line ?? "")
  await writeFile(file, `${[LEDGER_HEADER.join("\t"), ...body].join("\n")}\n`)
}

// Every way the local check file can be unusable is one precondition line naming the file and the reason.
const loadSpec = async (specPath: string, sourceIds: string[]): Promise<SourceSpec> => {
  const why = (reason: string): never =>
    fail(`SP-B precondition missing: local bunshin source-check file ${reason} (${specPath})`)
  let text = ""
  try {
    text = await readFile(specPath, "utf8")
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String(e.code) : "unknown"
    why(code === "ENOENT" ? "not found" : `unreadable (${code})`)
  }
  if (!text.trim()) why("is empty")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    why("is not valid JSON")
  }
  if (typeof raw !== "object" || raw === null || !("bunshinSrc" in raw) || !("rows" in raw))
    why("lacks bunshinSrc or rows")
  const spec = raw as SourceSpec
  if (typeof spec.rows !== "object" || spec.rows === null || Array.isArray(spec.rows))
    why("has rows that is not an object")
  const missing = sourceIds.filter((id) => !(id in spec.rows))
  if (missing.length) why(`lacks entries for rows ${missing.join(", ")}`)
  const invalid = sourceIds.filter((id) => !validEntry(spec.rows[id]))
  if (invalid.length)
    why(
      `has rows without a usable check (need at least one check, each with kind present|absent, a non-empty pattern and a paths list): ${invalid.join(", ")}`,
    )
  return spec
}

const validEntry = (entry: unknown): boolean => {
  if (typeof entry !== "object" || entry === null || !("checks" in entry)) return false
  const checks: unknown = entry.checks
  if (!Array.isArray(checks) || checks.length === 0) return false
  return checks.every(
    (c: unknown) =>
      typeof c === "object" &&
      c !== null &&
      "kind" in c &&
      (c.kind === "present" || c.kind === "absent") &&
      "pattern" in c &&
      typeof c.pattern === "string" &&
      c.pattern.length > 0 &&
      "paths" in c &&
      Array.isArray(c.paths) &&
      c.paths.every((p: unknown) => typeof p === "string"),
  )
}

// A ledger the run must read is a precondition: one exit-2 line naming the file and the reason.
const readLedger = async (file: string, purpose: string) => {
  try {
    return parseLedger(await readFile(file, "utf8"))
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String(e.code) : "unknown"
    return fail(
      `SP-B precondition missing: ledger for ${purpose} ${code === "ENOENT" ? "not found" : `unreadable (${code})`} (${file})`,
    )
  }
}

// The root leg is opt-in: it needs Linux, passwordless sudo and python3 under sudo, each a precondition.
const checkRootPreconditions = async () => {
  if (process.platform !== "linux") fail("SP-B precondition missing: --allow-sudo needs Linux")
  if ((await run(["sudo", "-n", "true"])).code !== 0)
    fail("SP-B precondition missing: --allow-sudo given but passwordless sudo is unavailable")
  if ((await run(["sudo", "-n", "/bin/sh", "-c", "command -v python3"])).code !== 0)
    fail("SP-B precondition missing: python3 not found for the root leg")
}

const main = async () => {
  const argv = process.argv.slice(2)
  const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const verify = flag("--verify")
  const writeTo = flag("--write")
  const only = flag("--row")
  const detailTo = flag("--detail")
  const allowSudo = argv.includes("--allow-sudo")
  if (!verify && !writeTo && !only)
    fail(`usage: bun ${SCRIPT} --verify <ledger> | --write <ledger> | --row <id> [--allow-sudo] [--detail <file>]`)
  if (verify && writeTo) fail("SP-B: --verify and --write cannot be combined")

  const bin = process.env.BUNSHIN_BIN ?? Bun.which("bunshin")
  if (!bin)
    fail(
      "SP-B precondition missing: no bunshin agent installed on this host (no `bunshin` on PATH and BUNSHIN_BIN unset)",
    )
  const runRoot = process.env.CU_RUN ?? path.join(os.homedir(), "omo-runs", "cu-v3")
  const specPath = process.env.SPB_SOURCE_CHECKS ?? path.join(runRoot, "evidence", "task-11.bunshin-source-checks.json")
  const spec = await loadSpec(
    specPath,
    rows.filter((r) => r.source).map((r) => r.id),
  )
  if ((await run(["git", "-C", spec.bunshinSrc, "rev-parse", "HEAD"])).code !== 0)
    fail("SP-B precondition missing: the bunshin checkout named by the source-check file is not a git checkout")

  const selected = only ? rows.filter((r) => r.id === only) : rows
  if (selected.length === 0) fail(`SP-B: unknown row ${only}`)
  if (verify && !allowSudo && selected.every((r) => r.rootLeg))
    fail(`SP-B: --verify --row ${only} would check nothing: it is a root-leg row, pass --allow-sudo`)
  if (allowSudo && selected.some((r) => r.rootLeg)) await checkRootPreconditions()
  const expected = verify ? await readLedger(verify, "--verify") : undefined
  // --write --row merges into an existing ledger; a full --write keeps the committed rows it cannot measure.
  const existing = writeTo
    ? only
      ? await readLedger(writeTo, "--write --row")
      : await readFile(writeTo, "utf8").then(parseLedger, () => new Map<string, { verdict: string; line: string }>())
    : new Map<string, { verdict: string; line: string }>()
  const home = await mkdtemp(path.join(tmpdir(), "sp-b-"))
  const ctx: Ctx = { bin: bin ?? "", home, spec, specPath, allowSudo }
  const results: Array<Row & Measured> = []
  let precondition = ""
  try {
    for (const row of selected) {
      const m = await row.measure(ctx).catch((e: Error) => {
        if (e instanceof PreconditionError) throw e
        return { verdict: "UNMEASURED" as Verdict, measured: `measurement error: ${e.message}` }
      })
      results.push({ ...row, ...m })
    }
  } catch (e) {
    if (!(e instanceof PreconditionError)) throw e
    precondition = e.message
  } finally {
    await rm(home, { recursive: true, force: true })
  }
  if (precondition) fail(precondition)

  let mismatches = 0
  let notRun = 0
  for (const r of results) {
    const want = expected?.get(r.id)?.verdict
    let status = "RESULT"
    if (expected && r.notRun && want !== r.verdict) {
      status = `NOT-RUN expected=${want ?? "<missing>"}`
      notRun++
    } else if (expected) {
      status = want === r.verdict ? "MATCH" : `MISMATCH expected=${want ?? "<missing>"}`
      if (want !== r.verdict) mismatches++
    }
    process.stdout.write(`${r.id}\t${r.verdict}\t${status}\t${r.measured}\n`)
  }
  // With --row only that row is compared; without it every ledger row must be measured.
  if (expected && !only) {
    for (const id of expected.keys())
      if (!results.some((r) => r.id === id)) {
        mismatches++
        process.stdout.write(`${id}\t-\tMISMATCH ledger row not measured by this probe\n`)
      }
  }
  if (detailTo)
    await writeFile(
      detailTo,
      `${JSON.stringify(
        results.map(({ measure: _m, ...r }) => r),
        null,
        2,
      )}\n`,
    )
  if (writeTo) await writeLedger(writeTo, results, existing)
  if (expected) {
    const tail = notRun ? ` not_run=${notRun} (root leg needs --allow-sudo)` : ""
    process.stdout.write(
      mismatches === 0
        ? `SPB_VERIFY_OK rows=${results.length - notRun}${tail}\n`
        : `SPB_VERIFY_FAIL mismatches=${mismatches}${tail}\n`,
    )
    process.exit(mismatches === 0 ? 0 : 1)
  }
}

await main()
