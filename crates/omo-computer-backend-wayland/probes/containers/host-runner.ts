// SP-W host runner: builds and runs one probe container at a time, behind a load gate. Runs on the HOST.
import { readFileSync } from "node:fs"
import type { Compositor } from "./common/session-kit.ts"
import { containerOutcome } from "./run-plan.ts"

export type Row = {
  id: string
  compositor: Compositor
  qid: string
  answer: boolean | null
  observed: string
  reason?: string
  precondition?: string
  pkgs: string
}

const PROBES = `${import.meta.dir}/..`
const log = (s: string) => console.error(s)

export async function sh(cmd: string[], opts: { inherit?: boolean } = {}) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: opts.inherit ? "inherit" : "pipe" })
  const out = await new Response(p.stdout).text()
  const err = opts.inherit ? "" : await new Response(p.stderr ?? new Blob()).text()
  return { code: await p.exited, out, err }
}

async function loadGate(label: string) {
  const n = Number((await sh(["nproc"])).out.trim())
  for (;;) {
    const load1 = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0])
    const up = (await sh(["uptime"])).out.trim()
    if (load1 < 2 * n) return log(`LOAD_GATE ok before ${label}: load1=${load1} limit=${2 * n} | ${up}`)
    log(`LOAD_GATE wait before ${label}: load1=${load1} > limit=${2 * n} | ${up}`)
    await Bun.sleep(30_000)
  }
}

const baseOf = (c: Compositor) =>
  (/^FROM (\S+)/m.exec(readFileSync(`${PROBES}/containers/${c}/Dockerfile`, "utf8")) ?? [])[1] ?? "?"

async function buildImage(c: Compositor): Promise<string> {
  await loadGate(`docker build ${c}`)
  const b = await sh(
    [
      "docker",
      "build",
      "-q",
      "-t",
      `omo-spw-${c}:local`,
      "-f",
      `${PROBES}/containers/${c}/Dockerfile`,
      `${PROBES}/containers`,
    ],
    { inherit: true },
  )
  if (b.code !== 0) throw new Error(`docker build ${c} failed`)
  return (await sh(["docker", "image", "inspect", "-f", "{{.Id}}", `omo-spw-${c}:local`])).out.trim()
}

export async function runContainer(c: Compositor, ids: string[]): Promise<Row[]> {
  const image = await buildImage(c)
  await loadGate(`docker run ${c}`)
  const name = `omo-spw-${c}-${process.pid}-${Date.now()}`
  const args = [
    "docker",
    "run",
    "--rm",
    "--init",
    "--cpus=2",
    "--name",
    name,
    "--shm-size",
    "1g",
    "-v",
    `${PROBES}:/probes:ro`,
    "-v",
    `${process.execPath}:/usr/local/bin/bun:ro`,
    `omo-spw-${c}:local`,
    "bash",
    "/probes/containers/common/session.sh",
    "run",
    c,
    "--",
    "bun",
    "/probes/probe-sp-w.ts",
    "--in-session",
    "--compositor",
    c,
    "--question",
    ids.join(","),
  ]
  log(`CONTAINER_START ${name} image=${image}`)
  try {
    const r = await sh(args, { inherit: true })
    const requested = ids.map((q) => `SPW-${c}-${q}`)
    // a container that reported nothing (or only some rows) yields those rows UNMEASURED with its exit code
    const { rows, missing } = containerOutcome(requested, r.out, r.code)
    if (missing.length) log(`ROWS_MISSING ${name} exit=${r.code}: ${missing.join(" ")} (recorded UNMEASURED)`)
    const reportedPkgs = rows.map((x) => ("pkgs" in x && typeof x.pkgs === "string" ? x.pkgs : "")).find(Boolean) ?? "-"
    return rows.map((row): Row => {
      const f: Record<string, unknown> = row
      return {
        id: row.id,
        compositor: c,
        qid: row.id.replace(`SPW-${c}-`, ""),
        answer: row.answer === true || row.answer === false ? row.answer : null,
        observed: typeof f.observed === "string" ? f.observed : "-",
        ...(typeof f.reason === "string" ? { reason: f.reason } : {}),
        ...(typeof f.precondition === "string" ? { precondition: f.precondition } : {}),
        pkgs: `${typeof f.pkgs === "string" ? f.pkgs : reportedPkgs}|${image}`,
      }
    })
  } finally {
    await sh(["docker", "rm", "-f", name])
    const left = (await sh(["docker", "ps", "-a", "-q", "--filter", `name=${name}`])).out.trim()
    log(`CONTAINER_REMOVED ${name} remaining=${left ? left : "none"}`)
  }
}

export async function hostBuild(c: Compositor, pkgs: string): Promise<string> {
  const [kernel, docker] = await Promise.all([
    sh(["uname", "-srm"]),
    sh(["docker", "version", "--format", "{{.Server.Version}}"]),
  ])
  const [list, image] = pkgs.split("|")
  return `measured ${new Date().toISOString().slice(0, 10)}; host ${kernel.out.trim()}; docker ${docker.out.trim()}; base ${baseOf(c)}; image ${(image ?? "").slice(0, 19)}; ${list}`
}
