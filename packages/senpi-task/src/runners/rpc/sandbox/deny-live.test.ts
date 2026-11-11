import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prepareChildDirs, type ChildDirs } from "./child-dirs"
import { planDenyLive, type DenyLivePlan } from "./plan"
import { preflightDenyLive } from "./preflight"
import { writeUnixSocketFilter } from "./seccomp"
import { wrapDenyLive } from "./wrap"

const platform = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined
const binary = platform === "darwin" ? "/usr/bin/sandbox-exec" : "bwrap"
// Present is not usable: Ubuntu 24.04's apparmor_restrict_unprivileged_userns=1 makes every bwrap die
// with "setting up uid map: Permission denied". Such a host must refuse, so it gets that test instead.
const usable = platform !== undefined && (platform === "darwin"
  ? spawnSync(binary, ["-p", "(version 1)(allow default)", "/usr/bin/true"]).status === 0
  : spawnSync(binary, ["--ro-bind", "/", "/", "true"], { env: { PATH: "/usr/bin:/bin" } }).status === 0)
const present = platform !== undefined && (platform === "darwin" || spawnSync("sh", ["-c", "command -v bwrap"]).status === 0)

type World = { root: string; home: string; agent: string; state: string; cwd: string; plan: DenyLivePlan; dirs: ChildDirs; seccomp: string | undefined }

// A real install: config FILES in the agent dir (the v4 preflight died with ENOTDIR on them), seeded
// extensions, the daemon key dir, a git project with an existing `.claude` and no `.omo`.
function world(): World {
  const root = mkdtempSync(join(tmpdir(), "deny-live-"))
  const home = join(root, "home")
  const agent = join(home, ".omo/agent")
  for (const dir of [".omo/omocat", ".omo/agent/extensions", ".omo/agent/rpc/keys", ".omo/agent/cache", "project/.git", "project/.claude"]) {
    mkdirSync(join(home, dir), { recursive: true })
  }
  for (const file of ["settings.json", "models.json", "trust.json", "auth.json"]) writeFileSync(join(agent, file), "{}\n")
  writeFileSync(join(home, ".omo/omocat/tool.ts"), "live\n")
  writeFileSync(join(agent, "extensions/diff.js"), "live\n")
  writeFileSync(join(home, "project/.git/config"), "[core]\n")
  const state = join(agent, "projects/p/senpi-task/children/st_x")
  mkdirSync(state, { recursive: true })
  const decision = planDenyLive({ platform: platform ?? "linux", home, agentDir: agent, stateDir: state, cwd: join(home, "project"), codeRoots: [] })
  if (decision.kind !== "confined") throw new Error(decision.reason)
  const dirs = prepareChildDirs(decision.plan)
  const seccomp = decision.plan.platform === "linux" ? writeUnixSocketFilter(decision.plan.tmpDir) : undefined
  return { root, home, agent, state, cwd: join(home, "project"), plan: decision.plan, dirs, seccomp }
}

function runConfined(w: World, script: string): { status: number | null; lines: readonly string[] } {
  const wrapped = wrapDenyLive(w.plan, "/bin/sh", ["-c", script], w.seccomp)
  const fd = wrapped.seccompFile === undefined ? undefined : openSync(wrapped.seccompFile, "r")
  try {
    const run = spawnSync(wrapped.command, [...wrapped.args], {
      encoding: "utf8", cwd: w.cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      stdio: fd === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", fd],
    })
    return { status: run.status, lines: run.stdout.trim().split("\n") }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

describe.skipIf(!usable)("deny-live sandbox on a real backend", () => {
  let w: World
  beforeEach(() => {
    w = world()
  })
  afterEach(() => {
    w.dirs.release()
    rmSync(w.root, { recursive: true, force: true })
  })

  test("#given a reviewer child under the sandbox #when it writes to the engine and the project's control files #then every write is refused and the live bytes are unchanged", () => {
    // when
    const probe = (name: string, command: string) => `(${command}) 2>/dev/null && echo ${name}-ok || echo ${name}-denied`
    const { status, lines } = runConfined(w, [
      probe("live", `printf x >> ${join(w.home, ".omo/omocat/tool.ts")}`),
      probe("ext", `printf new > ${join(w.plan.viewDir, "extensions/diff.js")}`),
      probe("home", `touch ${join(w.home, "dotfile")}`),
      probe("gitcfg", `printf x >> ${join(w.cwd, ".git/config")}`),
      probe("projext", `mkdir -p ${join(w.cwd, ".omo/extensions")}`),
      probe("mcp", `printf '{}' > ${join(w.cwd, ".mcp.json")}`),
      probe("cwd", `printf ok > ${join(w.cwd, "notes.md")}`),
      probe("report", `printf ok > ${join(w.plan.artifactDir, "report.md")}`),
      probe("state", `printf ok > ${join(w.state, "sessions-probe")}`),
      probe("tmp", `printf ok > ${join(w.plan.tmpDir, "t")}`),
    ].join("\n"))

    // then
    expect(status).toBe(0)
    expect(lines).toEqual(["live-denied", "ext-denied", "home-denied", "gitcfg-denied", "projext-denied", "mcp-denied", "cwd-ok", "report-ok", "state-ok", "tmp-ok"])
    expect(readFileSync(join(w.home, ".omo/omocat/tool.ts"), "utf8")).toBe("live\n")
    expect(readFileSync(join(w.agent, "extensions/diff.js"), "utf8")).toBe("live\n")
    expect(readFileSync(join(w.cwd, ".git/config"), "utf8")).toBe("[core]\n")
  })

  test("#given a real install with config files in the agent dir #when preflight runs #then it proves the confinement", () => {
    expect(preflightDenyLive(w.plan, w.seccomp, w.home)).toMatchObject({ ok: true })
  })

  test("#given probe files a killed parent left behind #when preflight runs #then only the ones older than a minute are swept, whatever pid they name", () => {
    // given: one stale probe named for this live process, one fresh probe named for a pid that cannot exist
    const stale = join(w.plan.liveRoot, `.omo-sandbox-probe-${process.pid}-stale-live`)
    const fresh = join(w.plan.liveRoot, ".omo-sandbox-probe-999999999-fresh-dead")
    writeFileSync(stale, "x")
    writeFileSync(fresh, "x")
    const twoMinutesAgo = new Date(Date.now() - 120_000)
    utimesSync(stale, twoMinutesAgo, twoMinutesAgo)

    // when
    preflightDenyLive(w.plan, w.seccomp, w.home)

    // then
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  test("#given a wrapper that does not confine #when preflight runs #then it refuses on a deny check", () => {
    // given: a backend that accepts the wrapper's argv and runs the command with no confinement at all
    const passthrough = join(w.root, "passthrough.sh")
    writeFileSync(passthrough, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 })

    // when
    const result = preflightDenyLive({ ...w.plan, backend: passthrough }, w.seccomp, w.home)

    // then
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("a write that must be denied succeeded") })
  })

  test("#given a listening unix socket the parent owns #when the child connects to it #then the sandbox refuses with EPERM", () => {
    // given
    const sock = join("/tmp", `deny-live-${process.pid}.sock`)
    const server = Bun.listen({ unix: sock, socket: { data: () => undefined } })
    try {
      // when: exit status is the errno of the refused step (Linux: socket(), macOS: connect())
      const { lines } = runConfined(w, `/usr/bin/perl -MSocket -e 'socket(my $c, PF_UNIX, SOCK_STREAM, 0) or exit($! + 0); connect($c, pack_sockaddr_un($ARGV[0])) or exit($! + 0); exit 0' ${sock}; echo rc=$?`)

      // then
      expect(lines).toEqual(["rc=1"])
    } finally {
      server.stop(true)
      rmSync(sock, { force: true })
    }
  })
})

describe.skipIf(!present || usable)("deny-live sandbox on a host whose backend cannot run", () => {
  test("#given a sandbox binary that cannot create its namespace #when preflight runs #then the spawn is refused", () => {
    const w = world()
    try {
      expect(preflightDenyLive(w.plan, w.seccomp, w.home)).toMatchObject({ ok: false, reason: expect.stringContaining("the sandbox wrapper failed to run the probe") })
    } finally {
      w.dirs.release()
      rmSync(w.root, { recursive: true, force: true })
    }
  })
})

describe("deny-live plan refusals", () => {
  const base = { home: tmpdir(), agentDir: join(tmpdir(), ".omo/agent"), stateDir: tmpdir(), cwd: tmpdir(), codeRoots: [], liveRoot: tmpdir() }

  test("#given no sandbox binary #when planning #then the spawn is refused", () => {
    expect(planDenyLive({ ...base, platform: "linux", which: () => undefined })).toEqual({ kind: "unavailable", reason: "bwrap not found" })
  })

  test("#given Windows #when planning #then the spawn is refused", () => {
    expect(planDenyLive({ ...base, platform: "win32" }).kind).toBe("unavailable")
  })

  test("#given an engine that loads its plugin from inside the task cwd #when planning #then the spawn is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "deny-live-dev-"))
    try {
      mkdirSync(join(root, "packages/plugin"), { recursive: true })
      const decision = planDenyLive({ ...base, platform: "linux", which: () => "/usr/bin/bwrap", cwd: root, codeRoots: [join(root, "packages/plugin")] })
      expect(decision).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("isolated checkout") })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a missing live root #when planning #then the spawn is refused", () => {
    const decision = planDenyLive({ ...base, platform: "linux", which: () => "/usr/bin/bwrap", liveRoot: join(tmpdir(), "no-such-omo-root") })
    expect(decision.kind).toBe("unavailable")
    expect(existsSync(join(tmpdir(), "no-such-omo-root"))).toBe(false)
  })
})
