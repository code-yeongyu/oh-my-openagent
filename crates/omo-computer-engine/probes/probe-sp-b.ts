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
type Measured = { verdict: Verdict; measured: string; detail?: unknown }
type Row = { id: string; gap: string; condition: string; owner: string; measure: (ctx: Ctx) => Promise<Measured> }
type SourceCheck = { kind: "present" | "absent"; pattern: string; paths: string[] }
type SourceSpec = { bunshinSrc: string; rows: Record<string, { checks: SourceCheck[]; holds: Verdict }> }
type Ctx = { bin: string; home: string; spec: SourceSpec; specPath: string }

const LEDGER_HEADER = ["id", "gap", "condition", "measured", "verdict", "rerun", "host_build", "owner", "evidence"]
const SCRIPT = "crates/omo-computer-engine/probes/probe-sp-b.ts"
const HELPER = path.join(import.meta.dir, "probe-sp-b-root-watch.sh")

const fail = (line: string, code = 2): never => {
  process.stderr.write(`${line}\n`)
  process.exit(code)
}

const run = async (cmd: string[], env?: Record<string, string>) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env })
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

const sourceRow = async (ctx: Ctx, id: string): Promise<Measured> => {
  const row = ctx.spec.rows[id]
  if (!row) return { verdict: "CHANGED", measured: `no source check for ${id} in the local check file` }
  const results = []
  for (const check of row.checks) {
    const r = await run(["git", "-C", ctx.spec.bunshinSrc, "grep", "-nE", check.pattern, "--", ...check.paths])
    if (r.code > 1) throw new Error(`git grep failed (${r.code}): ${r.stderr.trim()}`)
    const hits = r.stdout.split("\n").filter(Boolean)
    results.push({ ...check, hits: hits.length, ok: check.kind === "present" ? hits.length > 0 : hits.length === 0 })
  }
  const okCount = results.filter((r) => r.ok).length
  const verdict = okCount === results.length ? row.holds : "CHANGED"
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
    measure: (ctx) => sourceRow(ctx, "B-01b"),
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
    measure: (ctx) => sourceRow(ctx, "B-04b"),
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
    measure: (ctx) => sourceRow(ctx, "B-05b"),
  },
  {
    id: "B-05c",
    gap: "root agent without a display",
    condition: "kernel premise of the host-death watch across the uid drop (stand-in, no bunshin)",
    owner: "row 62",
    measure: async () => {
      if (process.platform !== "linux") return { verdict: "UNMEASURED", measured: "needs Linux" }
      const sudo = await run(["sudo", "-n", "true"])
      if (sudo.code !== 0) return { verdict: "UNMEASURED", measured: "needs passwordless sudo on this host" }
      const uid = String(process.getuid?.() ?? 1000)
      const gid = String(process.getgid?.() ?? 1000)
      const r = await run(["sudo", "-n", "/bin/sh", HELPER, uid, gid])
      if (r.code !== 0) return { verdict: "CONTRADICTS", measured: `helper exited ${r.code}: ${r.stderr.trim()}` }
      const d = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as {
        pdeathsigAfterDrop: number
        hostWatch: string
        launcherGoneMs: number
        engineGoneMs: number
        residualPids: number[]
      }
      const ok =
        d.pdeathsigAfterDrop === 0 &&
        d.hostWatch === "pidfd" &&
        d.launcherGoneMs <= 2000 &&
        d.engineGoneMs <= 2000 &&
        d.residualPids.length === 0
      return {
        verdict: ok ? "open-with-row" : "CONTRADICTS",
        measured: `PR_GET_PDEATHSIG after drop=${d.pdeathsigAfterDrop}; hostWatch=${d.hostWatch}; launcher gone ${d.launcherGoneMs} ms, engine gone ${d.engineGoneMs} ms after kill -9 of the stand-in agent; residual pids ${d.residualPids.length}`,
        detail: d,
      }
    },
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
    measure: (ctx) => sourceRow(ctx, "B-07a"),
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
    measure: (ctx) => sourceRow(ctx, "B-07c"),
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
    measure: (ctx) => sourceRow(ctx, "B-08c"),
  },
  {
    id: "B-09",
    gap: "sidecar audit",
    condition: "per-call audit record on the sidecar path (source)",
    owner: "row 64",
    measure: (ctx) => sourceRow(ctx, "B-09"),
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
    measure: (ctx) => sourceRow(ctx, "B-10b"),
  },
]

const hostBuild = () => `${os.type().toLowerCase()} ${os.release()} ${os.arch()}`

const parseLedger = (text: string) => {
  const lines = text.split("\n").filter((l) => l.length > 0)
  if (lines[0] !== LEDGER_HEADER.join("\t"))
    fail(`SP-B ledger malformed: line 1 is not the header ${LEDGER_HEADER.join(",")}`, 1)
  const map = new Map<string, string>()
  lines.slice(1).forEach((line, i) => {
    const cols = line.split("\t")
    if (cols.length !== LEDGER_HEADER.length || !cols[4] || !cols[5])
      fail(`SP-B ledger malformed: line ${i + 2} has ${cols.length} columns or an empty verdict/rerun`, 1)
    map.set(cols[0] ?? "", cols[4] ?? "")
  })
  return map
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
  if (!verify && !writeTo && !only)
    fail(`usage: bun ${SCRIPT} --verify <ledger> | --write <ledger> | --row <id> [--detail <file>]`)

  const bin = process.env.BUNSHIN_BIN ?? Bun.which("bunshin")
  if (!bin)
    fail(
      "SP-B precondition missing: no bunshin agent installed on this host (no `bunshin` on PATH and BUNSHIN_BIN unset)",
    )
  const runRoot = process.env.CU_RUN ?? path.join(os.homedir(), "omo-runs", "cu-v3")
  const specPath = process.env.SPB_SOURCE_CHECKS ?? path.join(runRoot, "evidence", "task-11.bunshin-source-checks.json")
  const specText = await readFile(specPath, "utf8").catch(() => undefined)
  if (!specText) fail(`SP-B precondition missing: local bunshin source-check file not found (${specPath})`)
  const spec = JSON.parse(specText ?? "{}") as SourceSpec
  if ((await run(["git", "-C", spec.bunshinSrc, "rev-parse", "HEAD"])).code !== 0)
    fail("SP-B precondition missing: the bunshin checkout named by the source-check file is not a git checkout")

  const expected = verify ? parseLedger(await readFile(verify, "utf8")) : undefined
  const home = await mkdtemp(path.join(tmpdir(), "sp-b-"))
  const ctx: Ctx = { bin: bin ?? "", home, spec, specPath }
  const selected = only ? rows.filter((r) => r.id === only) : rows
  if (selected.length === 0) fail(`SP-B: unknown row ${only}`)
  const results: Array<Row & Measured> = []
  try {
    for (const row of selected) {
      const m = await row
        .measure(ctx)
        .catch((e: Error) => ({ verdict: "CHANGED" as Verdict, measured: `error: ${e.message}` }))
      results.push({ ...row, ...m })
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }

  let mismatches = 0
  for (const r of results) {
    const want = expected?.get(r.id)
    const status = expected ? (want === r.verdict ? "MATCH" : `MISMATCH expected=${want ?? "<missing>"}`) : "RESULT"
    if (expected && want !== r.verdict) mismatches++
    process.stdout.write(`${r.id}\t${r.verdict}\t${status}\t${r.measured}\n`)
  }
  if (expected) {
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
  if (writeTo) {
    const body = results.map((r) =>
      [
        r.id,
        r.gap,
        r.condition,
        r.measured,
        r.verdict,
        `bun ${SCRIPT} --row ${r.id}`,
        hostBuild(),
        r.owner,
        `$EV/task-11.bunshin-proof.txt#${r.id}`,
      ].join("\t"),
    )
    await writeFile(writeTo, `${[LEDGER_HEADER.join("\t"), ...body].join("\n")}\n`)
  }
  if (expected) {
    process.stdout.write(
      mismatches === 0 ? `SPB_VERIFY_OK rows=${results.length}\n` : `SPB_VERIFY_FAIL mismatches=${mismatches}\n`,
    )
    process.exit(mismatches === 0 ? 0 : 1)
  }
}

await main()
