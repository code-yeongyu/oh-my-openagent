import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { observedLaunch, RAW_HOST_LAUNCH_ENV, takeRawHostLaunch } from "../bin/lib/host-launch.js"
import { capturedStdoutHandoffFor } from "../bin/lib/private-fd-table.js"
import { formatDoctorLines, formatEndpointLines } from "../bin/lib/daemon-status.js"
import { buildSenpiArgs } from "../compile-args"

test("npm daemon run, host ensure, host handoff and host session open give the engine the product launch spec", () => {
  // The launcher names its spec by its own real path, so the expectation does too: macOS tmpdir is /var -> /private/var,
  // and a Windows tmpdir can carry an 8.3 short home (RUNNER~1) that only the native realpath expands.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-host-launch-")))
  try {
    const home = join(root, "home")
    const engine = join(root, "node_modules", "@code-yeongyu", "senpi")
    const spec = join(root, "plugin", "daemon-launch-spec.json")
    const capture = join(root, "calls")
    mkdirSync(join(engine, "dist/core"), { recursive: true })
    mkdirSync(join(root, "plugin"))
    mkdirSync(home)
    cpSync(join(import.meta.dir, "../bin"), join(root, "bin"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "omo-ai", type: "module", version: "1.0.0" }))
    writeFileSync(spec, "{}")
    writeFileSync(
      join(engine, "package.json"),
      JSON.stringify({ name: "@code-yeongyu/senpi", type: "module", exports: "./dist/index.js" }),
    )
    writeFileSync(join(engine, ".omo-engine-prepared"), "1.0.0\n")
    writeFileSync(join(engine, "dist/index.js"), "")
    writeFileSync(join(engine, "dist/core/brand.js"), "")
    writeFileSync(
      join(engine, "dist/cli.js"),
      `
      import { appendFileSync } from "node:fs"
      const args = process.argv.slice(2)
      appendFileSync(process.env.CAPTURE, JSON.stringify(args) + "\\n")
      console.log(JSON.stringify(args[1] === "status" ? { reachable: false } : { action: "start" }))
    `,
    )
    // #15263 review M1: a socket other than the operator's, and `host session open`, carry the spec too.
    for (const [args, engineCall] of [
      [
        ["daemon", "run"],
        ["host", "ensure"],
      ],
      [
        ["host", "ensure"],
        ["host", "ensure"],
      ],
      [
        ["host", "handoff"],
        ["host", "handoff"],
      ],
      [
        ["host", "ensure", "--socket", join(root, "other.sock")],
        ["host", "ensure", "--socket", join(root, "other.sock")],
      ],
      [
        ["host", "session", "open"],
        ["host", "session", "open"],
      ],
    ] as const) {
      // On win32 omo daemon refuses before it starts anything (exit 4, no unix socket); the host rows still run there.
      if (process.platform === "win32" && args[0] === "daemon") continue
      writeFileSync(capture, "")
      const result = spawnSync(process.execPath, [join(root, "bin/omo.js"), ...args], {
        cwd: home,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: home, OMO_CODING_AGENT_DIR: join(home, "agent"), CAPTURE: capture },
      })
      expect(result.status, result.stderr).toBe(0)
      const calls: string[][] = readFileSync(capture, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const start = calls.find((call) => engineCall.every((arg, index) => call[index] === arg))
      expect(start, args.join(" ")).toContain("--launch-spec")
      expect(start?.[start.indexOf("--launch-spec") + 1]).toBe(spec)
      const compiled = buildSenpiArgs([...engineCall], root)
      expect(compiled.slice(compiled.indexOf("--launch-spec"))).toEqual(["--launch-spec", spec])
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// #15263 review L2: only the compiled launcher's own hop, which names its pid, skips the observation.
test("a raw host launch marker is honored only from the parent that set it, and never left behind", () => {
  for (const [marker, honored] of [
    ["1", false],
    ["41", false],
    ["42", true],
    [undefined, false],
  ] as const) {
    const env: Record<string, string | undefined> = marker === undefined ? {} : { [RAW_HOST_LAUNCH_ENV]: marker }
    expect(takeRawHostLaunch(env, 42), String(marker)).toBe(honored)
    expect(RAW_HOST_LAUNCH_ENV in env).toBe(false)
  }
})

test("a captured host launch without a private descriptor table pipes only stdout", () => {
  expect(capturedStdoutHandoffFor({ KEEP: "yes" }, undefined)).toEqual({
    env: { KEEP: "yes" },
    stdio: ["inherit", "pipe", "inherit"],
  })
})

test("an older or unresponsive host leaves ensure successful and explicitly unobserved", async () => {
  const result = { exitCode: 0, stdout: JSON.stringify({ socket: "/test/rpc.sock", action: "reuse", pid: 7 }) }
  for (const fixture of [undefined, {}]) {
    const calls: number[] = []
    const answer = await observedLaunch(result, {
      args: ["host", "ensure"],
      agentDir: "/test",
      pluginRoot: "/test/plugin",
      budgetMs: 13,
      observe: async (_socket: string, budget: number) => {
        calls.push(budget)
        return fixture
      },
    })
    expect(calls).toEqual([13])
    expect(answer.exitCode).toBe(0)
    expect(JSON.parse(answer.stdout)).toMatchObject({ action: "reuse", pid: 7, productPlugin: "unknown" })
  }
})
test("status and doctor distinguish the live primary's reported extensions from an unobserved profile", () => {
  for (const [extensions, expected] of [
    // Native separators, as a live primary reports them on every platform (#15312: a POSIX literal missed on win32).
    [[join("/runtime", "plugin"), join("/runtime", "plugin", "extensions", "omo-member.js")], "loaded"],
    [[], "absent"],
    [undefined, "unknown"],
  ] as const) {
    const endpoints = [{ reachable: true, socket: "/agent/rpc/rpc.sock", launchProfile: { core: { extensions } } }]
    expect(formatEndpointLines(endpoints)[0]).toContain(`product plugin: ${expected}`)
    expect(formatDoctorLines(endpoints)[0]).toContain(`product plugin: ${expected}`)
  }
})
