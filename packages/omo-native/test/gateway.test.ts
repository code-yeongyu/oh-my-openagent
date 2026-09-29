import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gatewayDoctorLines, runGatewayCommand } from "../bin/lib/gateway.js"
import { resolveGatewayConfig, validateGatewayConfig } from "../gateway-schema-entry"

/**
 * `omo gateway` is a thin wrapper over the user config's `gateway` section (~/.omo/omo.jsonc or
 * ~/.omo/omo.json): these tests pin the contract the plan sets - every subcommand prints `not
 * configured` and exits 0 without the section, `status --json` reports scope ids with empty
 * connector lists, unknown subcommands exit 2, a project layer never configures it, and the doctor
 * row names schema paths through the real resolver and validator.
 */

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const SAMPLE = { gateway: { scopes: [{ id: "qa" }] } }
const runtime = async () => ({ resolveGatewayConfig, validateGatewayConfig })
const roots: string[] = []

type Place = { home: string; cwd: string; env: { HOME: string } }

function place(files: { userJsonc?: string; userJson?: string; agentJson?: string; project?: string } = {}): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-gateway-cli-")))
  roots.push(home)
  const cwd = join(home, "repo")
  mkdirSync(join(home, ".omo", "agent"), { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  if (files.userJsonc !== undefined) writeFileSync(join(home, ".omo", "omo.jsonc"), files.userJsonc)
  if (files.userJson !== undefined) writeFileSync(join(home, ".omo", "omo.json"), files.userJson)
  if (files.agentJson !== undefined) writeFileSync(join(home, ".omo", "agent", "omo.json"), files.agentJson)
  if (files.project !== undefined) writeFileSync(join(cwd, ".omo", "omo.jsonc"), files.project)
  return { home, cwd, env: { HOME: home } }
}

async function run(args: string[], at: Place, loadRuntime = runtime): Promise<{ exitCode: number; out: string; err: string }> {
  let out = ""
  let err = ""
  const exitCode = await runGatewayCommand(args, {
    cwd: at.cwd,
    env: at.env,
    loadRuntime,
    stdout: { write: (text: string) => { out += text } },
    stderr: { write: (text: string) => { err += text } },
  })
  return { exitCode, out, err }
}

function doctorLines(at: Place): Promise<string[]> {
  return gatewayDoctorLines({ cwd: at.cwd, env: at.env, loadRuntime: runtime })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo gateway dispatcher", () => {
  test("#given no gateway section anywhere #when any subcommand runs #then it prints not configured and exits 0", async () => {
    // given
    const at = place({ userJson: JSON.stringify({ disabled_skills: [] }) })

    // when / then
    for (const subcommand of ["status", "connect", "lead", "rules", "link", "service"]) {
      const result = await run([subcommand], at)
      expect(result.exitCode).toBe(0)
      expect(result.out).toBe("not configured\n")
    }
  })

  test("#given gateway in the user omo.jsonc with a comment #when status runs with --json #then it prints the exact scopes document", async () => {
    // given
    const at = place({ userJsonc: `// my gateway\n${JSON.stringify(SAMPLE)}` })

    // when
    const result = await run(["status", "--json"], at)

    // then
    expect(result).toEqual({ exitCode: 0, out: '{"scopes":[{"id":"qa","connectors":[]}]}\n', err: "" })
  })

  test("#given gateway in the user omo.json #when status runs #then it prints one line per scope", async () => {
    // given
    const at = place({ userJson: JSON.stringify(SAMPLE) })

    // when
    const result = await run(["status"], at)

    // then
    expect(result.exitCode).toBe(0)
    expect(result.out).toBe("gateway scope qa: 0 connectors\n")
  })

  test("#given gateway only in a project layer #when status runs #then it is not configured and the ignored file is named", async () => {
    // given
    const at = place({ project: JSON.stringify(SAMPLE) })

    // when
    const result = await run(["status", "--json"], at)

    // then
    expect(result.exitCode).toBe(0)
    expect(result.out).toBe("not configured\n")
    expect(result.err).toContain(join(at.cwd, ".omo", "omo.jsonc"))
  })

  test("#given gateway only in the agent-dir omo.json #when status runs #then that retired path is not read", async () => {
    // given
    const at = place({ agentJson: JSON.stringify(SAMPLE) })

    // when
    const result = await run(["status"], at)

    // then
    expect(result).toEqual({ exitCode: 0, out: "not configured\n", err: "" })
  })

  test("#given an unparseable user config #when status runs #then it fails open as not configured", async () => {
    // given
    const at = place({ userJsonc: "{ not json" })

    // when
    const result = await run(["status"], at)

    // then
    expect(result.exitCode).toBe(0)
    expect(result.out).toBe("not configured\n")
  })

  test("#given an empty or non-object gateway section #when status runs #then empty scopes or exit 2", async () => {
    // given
    const empty = place({ userJson: JSON.stringify({ gateway: {} }) })
    const scalar = place({ userJson: JSON.stringify({ gateway: "tokens" }) })

    // when / then
    expect((await run(["status", "--json"], empty)).out).toBe('{"scopes":[]}\n')
    const refused = await run(["status"], scalar)
    expect(refused.exitCode).toBe(2)
    expect(refused.err).toContain("must be an object")
  })

  test("#given a configured scope #when an unbuilt subcommand runs #then it refuses with exit 2", async () => {
    // given
    const at = place({ userJson: JSON.stringify(SAMPLE) })

    // when / then
    for (const subcommand of ["connect", "lead", "rules", "link", "service"]) {
      const result = await run([subcommand], at)
      expect(result.exitCode).toBe(2)
      expect(result.err).toContain("not implemented yet")
    }
  })

  test("#given no subcommand or an unknown one #when the dispatcher runs #then it exits 2 with usage", async () => {
    // given
    const at = place({ userJson: JSON.stringify(SAMPLE) })

    // when / then
    expect((await run([], at)).exitCode).toBe(2)
    const unknown = await run(["send"], at)
    expect(unknown.exitCode).toBe(2)
    expect(unknown.err).toContain("unknown subcommand 'send'")
    expect((await run(["--help"], at)).exitCode).toBe(0)
  })

  test("#given a runtime that cannot load #when status runs #then it exits 1 instead of claiming not configured", async () => {
    // given
    const at = place({ userJson: JSON.stringify(SAMPLE) })

    // when
    const result = await run(["status"], at, async () => { throw new Error("staged payload missing") })

    // then
    expect(result.exitCode).toBe(1)
    expect(result.out).toBe("")
    expect(result.err).toContain("staged payload missing")
  })
})

describe("omo doctor gateway row", () => {
  test("#given no gateway section #when the row is computed #then doctor output stays unchanged (no lines)", async () => {
    expect(await doctorLines(place())).toEqual([])
  })

  test("#given a valid user section #when the row is computed #then it passes and names the file", async () => {
    // given
    const at = place({ userJsonc: JSON.stringify(SAMPLE) })

    // when / then
    expect(await doctorLines(at)).toEqual([`PASS gateway config: valid (${join(at.home, ".omo", "omo.jsonc")})`])
  })

  test("#given an invalid platform in the user omo.jsonc #when the row is computed #then it fails naming the file and schema path", async () => {
    // given
    const at = place({ userJsonc: JSON.stringify({ gateway: { scopes: [{ id: "qa", surfaces: [{ platform: "irc" }] }] } }) })

    // when
    const lines = await doctorLines(at)

    // then
    expect(lines).toHaveLength(1)
    expect(lines[0]?.startsWith(`FAIL gateway config: ${join(at.home, ".omo", "omo.jsonc")}: gateway.scopes[0].surfaces[0].platform:`)).toBe(true)
  })

  test("#given gateway in a project layer #when the row is computed #then it warns naming the file and reports nothing configured", async () => {
    // given
    const at = place({ project: JSON.stringify(SAMPLE) })

    // when
    const lines = await doctorLines(at)

    // then
    expect(lines).toHaveLength(1)
    expect(lines[0]?.startsWith(`WARN gateway config: ignored ${join(at.cwd, ".omo", "omo.jsonc")}: gateway`)).toBe(true)
  })

  test("#given a runtime that cannot load #when the row is computed #then it fails open with no lines", async () => {
    // given
    const at = place({ userJson: JSON.stringify(SAMPLE) })

    // when
    const lines = await gatewayDoctorLines({ cwd: at.cwd, env: at.env, loadRuntime: async () => { throw new Error("missing") } })

    // then
    expect(lines).toEqual([])
  })

  test("#given a FAIL gateway row #when runDoctor finishes #then the process exits failing, and passes without it", () => {
    // given: a packaged install whose every other check passes
    const root = mkdtempSync(join(tmpdir(), "omo-gateway-doctor-"))
    roots.push(root)
    const app = join(root, "app")
    cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(app, path)), { recursive: true })
      writeFileSync(join(app, path), content)
    }
    const senpi = { "@code-yeongyu/senpi": "2026.8.9" }
    write("package.json", JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module", dependencies: senpi }))
    write("node_modules/@code-yeongyu/senpi/package.json", JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" } }))
    for (const file of ["dist/index.js", "dist/cli.js", "dist/core/brand.js"]) write(`node_modules/@code-yeongyu/senpi/${file}`, "export {}\n")
    for (const file of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]) write(file, "fixture\n")
    write("drive.mjs", [
      'import { runDoctor } from "./bin/lib/doctor.js"',
      "runDoctor({ harnesses: [] }, [], { gatewayConfig: JSON.parse(process.argv[2]), fetchDistTags: () => ({}), list: () => [], listDirs: () => [], hasRepo: () => false })",
    ].join("\n"))
    const doctor = (gatewayConfig: string[]) => spawnSync(process.execPath, [join(app, "drive.mjs"), JSON.stringify(gatewayConfig)], {
      encoding: "utf8",
      env: { ...process.env, OMO_CODING_AGENT_DIR: join(root, "agent") },
    })

    // when
    const control = doctor(["PASS gateway config: valid"])
    const failing = doctor(["FAIL gateway config: x"])

    // then
    expect(control.status).toBe(0)
    expect(failing.stdout).toContain("FAIL gateway config: x")
    expect(failing.status).toBe(1)
  })
})
