import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { observedLaunch } from "../bin/lib/host-launch.js"
import { buildSenpiArgs } from "../compile-args"

test("npm daemon run, host ensure and host handoff give the engine the product launch spec", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-host-launch-"))
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
    for (const args of [
      ["daemon", "run"],
      ["host", "ensure"],
      ["host", "handoff"],
    ]) {
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
      const start = calls.find(
        (call) => call[0] === "host" && call[1] === (args[1] === "handoff" ? "handoff" : "ensure"),
      )
      expect(start, args.join(" ")).toContain("--launch-spec")
      expect(start?.[start.indexOf("--launch-spec") + 1]).toBe(spec)
      const compiled = buildSenpiArgs(["host", args[1] === "handoff" ? "handoff" : "ensure"], root)
      expect(compiled.slice(compiled.indexOf("--launch-spec"))).toEqual(["--launch-spec", spec])
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
