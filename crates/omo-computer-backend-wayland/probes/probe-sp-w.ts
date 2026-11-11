#!/usr/bin/env bun
// SP-W probe: Wayland portal and compositor facts, measured in one container per compositor.
//
// On the host (Docker required):
//   bun probe-sp-w.ts --compositor <gnome|kde|sway> [--question <id>]   measure, print ledger rows (TSV)
//   bun probe-sp-w.ts --write <ledger.tsv> [--compositor <c>]...        measure and (re)write those rows
//   bun probe-sp-w.ts --verify <ledger.tsv>                             measure every row again; exit 0 iff
//                                                                       every verdict is identical
// Inside a probe container, under a session started by containers/common/session.sh:
//   bun probe-sp-w.ts --in-session --compositor <c> --question <id,...> | --verify <ledger.tsv>
// Before each docker build or run the host's 1-minute load must be under 2x nproc; the probe waits
// otherwise and logs the uptime reading it started on. Containers run one at a time and are removed.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { QUESTIONS } from "./containers/common/questions.ts"
import type { Compositor } from "./containers/common/session-kit.ts"
import { type Row, hostBuild, runContainer, sh } from "./containers/host-runner.ts"

const REL = "crates/omo-computer-backend-wayland/probes"
const COMPOSITORS: readonly Compositor[] = ["gnome", "kde", "sway"]
const HEADER = ["id", "compositor", "question", "condition", "verdict", "rerun", "observed", "host_build", "note"]
const PKGS: Record<Compositor, string[]> = {
  gnome: [
    "gnome-shell",
    "mutter",
    "xdg-desktop-portal",
    "xdg-desktop-portal-gnome",
    "pipewire",
    "libei1",
    "at-spi2-core",
    "gedit",
    "python3-pyqt6",
  ],
  kde: ["kwin-wayland", "xdg-desktop-portal", "xdg-desktop-portal-kde", "pipewire", "libei1", "at-spi2-core"],
  sway: ["sway", "libwlroots-0.18", "xdg-desktop-portal", "xdg-desktop-portal-wlr", "pipewire", "wtype"],
}

const isCompositor = (s: string): s is Compositor => (COMPOSITORS as readonly string[]).includes(s)
const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim() || "-"
const log = (s: string) => console.error(s)

// ---------- inside the container ----------
function requireSession(): Compositor {
  const wd = process.env.WAYLAND_DISPLAY
  const rt = process.env.XDG_RUNTIME_DIR ?? ""
  if (!wd || !existsSync(`${rt}/${wd}`)) {
    console.log(
      `SPW_PRECONDITION_MISSING: WAYLAND_DISPLAY ${wd ? `socket ${rt}/${wd} absent` : "is unset"}: no compositor session is running (start one with containers/common/session.sh run <compositor> -- <command>)`,
    )
    process.exit(2)
  }
  const c = process.env.SPW_COMPOSITOR ?? ""
  if (!isCompositor(c)) {
    console.log("SPW_PRECONDITION_MISSING: SPW_COMPOSITOR is not gnome, kde or sway")
    process.exit(2)
  }
  return c
}

async function measureInSession(c: Compositor, ids: string[]): Promise<Row[]> {
  const q = await sh(["dpkg-query", "-W", "-f", "${Package}=${Version} ", ...PKGS[c]])
  const rows: Row[] = []
  for (const id of ids) {
    const spec = QUESTIONS.find((x) => x.id === id && x.compositors.includes(c))
    if (!spec) throw new Error(`no question ${id} for ${c}`)
    log(`SPW measuring ${c}/${id}`)
    const a = await spec.run(c).catch((e: unknown) => ({
      answer: null,
      observed: "-",
      reason: `probe error: ${e instanceof Error ? e.message : String(e)}`,
    }))
    const row: Row = { id: `SPW-${c}-${id}`, compositor: c, qid: id, ...a, pkgs: q.out.trim() }
    console.log(`SPW_ROW ${JSON.stringify(row)}`)
    rows.push(row)
  }
  return rows
}

const verdict = (a: boolean | null) => (a === true ? "CONFIRMS" : a === false ? "CONTRADICTS" : "UNMEASURED")

async function toTsv(r: Row): Promise<string[]> {
  const spec = QUESTIONS.find((q) => q.id === r.qid)
  const v = verdict(r.answer)
  let note = r.answer === null ? `UNMEASURED: ${r.reason ?? "no reason recorded"}` : "-"
  if (r.qid === "release-on-close")
    note = `release: ${v === "CONFIRMS" ? "proven" : v === "CONTRADICTS" ? "contradicted" : "unproven"}${r.answer === null ? `; ${note}` : ""}`
  const rerun = `bun ${REL}/probe-sp-w.ts --compositor ${r.compositor} --question ${r.qid}`
  return [
    r.id,
    r.compositor,
    spec?.question ?? "?",
    spec?.condition ?? "?",
    v,
    rerun,
    r.observed,
    await hostBuild(r.compositor, r.pkgs),
    note,
  ].map(clean)
}

function readLedger(path: string): string[][] {
  return readFileSync(path, "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split("\t"))
}

async function verify(path: string, rowsFor: (c: Compositor, ids: string[]) => Promise<Row[]>, only?: Compositor) {
  const ledger = readLedger(path).filter((f) => !only || f[1] === only)
  let bad = 0
  for (const c of COMPOSITORS) {
    const mine = ledger.filter((f) => f[1] === c)
    if (!mine.length) continue
    const now = await rowsFor(
      c,
      mine.map((f) => (f[0] ?? "").replace(`SPW-${c}-`, "")),
    )
    for (const f of mine) {
      const got = now.find((r) => r.id === f[0])
      const v = got ? verdict(got.answer) : "MISSING"
      if (v === f[4]) console.log(`MATCH ${f[0]} ${v}`)
      else {
        bad++
        console.log(`MISMATCH ${f[0]} ledger=${f[4]} now=${v} observed=${got?.observed ?? "-"}`)
      }
    }
  }
  console.log(bad ? `VERIFY_FAIL mismatches=${bad} rows=${ledger.length}` : `VERIFY_OK rows=${ledger.length}`)
  return bad ? 1 : 0
}

const { values } = parseArgs({
  options: {
    compositor: { type: "string", multiple: true },
    question: { type: "string" },
    write: { type: "string" },
    verify: { type: "string" },
    "in-session": { type: "boolean" },
  },
})
const inContainer = existsSync("/.dockerenv")
const ids = (c: Compositor) =>
  values.question ? values.question.split(",") : QUESTIONS.filter((q) => q.compositors.includes(c)).map((q) => q.id)

if (inContainer) {
  const c = requireSession()
  if (values.verify) process.exit(await verify(values.verify, (cc, i) => measureInSession(cc, i), c))
  await measureInSession(c, ids(c))
} else if (values.verify) {
  process.exit(await verify(values.verify, runContainer))
} else {
  const chosen = (values.compositor ?? (values.write ? [...COMPOSITORS] : [])).filter(isCompositor)
  if (!chosen.length) {
    console.error(
      "usage: probe-sp-w.ts --compositor <gnome|kde|sway> [--question id] | --write <ledger> | --verify <ledger>",
    )
    process.exit(2)
  }
  const lines: string[] = []
  for (const c of chosen) for (const r of await runContainer(c, ids(c))) lines.push((await toTsv(r)).join("\t"))
  if (!values.write) console.log(lines.join("\n"))
  else {
    const keep = existsSync(values.write)
      ? readLedger(values.write)
          .filter((f) => !chosen.some((c) => c === f[1]))
          .map((f) => f.join("\t"))
      : []
    const order = (l: string) => {
      const [id = "", c = ""] = l.split("\t")
      return (
        (isCompositor(c) ? COMPOSITORS.indexOf(c) : 9) * 1000 + QUESTIONS.findIndex((q) => id === `SPW-${c}-${q.id}`)
      )
    }
    writeFileSync(
      values.write,
      [HEADER.join("\t"), ...[...keep, ...lines].sort((a, b) => order(a) - order(b))].join("\n") + "\n",
    )
    log(`LEDGER_WRITTEN ${values.write} rows=${keep.length + lines.length}`)
  }
}
