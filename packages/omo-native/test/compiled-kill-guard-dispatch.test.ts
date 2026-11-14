import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../test-support/remove-tree"

// Compiled-binary contract (#13449): inside a compiled binary the kill guard's shims run the binary itself as
// `<binary> __kill-guard check --vantage <pid> -- <argv...>` (the engine leaves the judge entry empty there), so the
// compiled entry must hand that hidden subcommand to the engine's judge before it boots anything. Only a real compiled
// executable built from compile-entry.ts exercises that route; the embedded runtime is the smallest one it accepts.
const exe = process.platform === "win32" ? ".exe" : ""
const root = mkdtempSync(join(tmpdir(), "omo-compiled-kill-guard-"))
const binary = join(root, "build", `omo${exe}`)
const version = "0.0.0-killguard-fixture"

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function freshHome(name: string): string {
  const home = join(root, name)
  mkdirSync(home, { recursive: true })
  return home
}

function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length))
    .sort()
}

async function run(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn([binary, ...args], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, DO_NOT_TRACK: "1", ...extraEnv },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code, output: `${stdout}\n${stderr}` }
}

beforeAll(async () => {
  // The embedded payload root is named exactly as the release build names it (EMBEDDED_PAYLOAD_ROOT).
  const stage = join(root, "stage", "omo-runtime")
  const packageJson = `${JSON.stringify({ name: "omo-ai", version })}\n`
  write(join(stage, "package.json"), packageJson)
  const manifest = {
    omoAiVersion: version,
    enginePin: "fixture",
    manifestSha: "fixture",
    entries: [
      {
        relPath: "package.json",
        sha256: createHash("sha256").update(packageJson).digest("hex"),
        mode: 0o600,
        size: Buffer.byteLength(packageJson),
      },
    ],
  }
  write(join(stage, "runtime-manifest.json"), `${JSON.stringify(manifest)}\n`)
  const entry = join(import.meta.dir, "..", "compile-entry.ts")
  const build = Bun.spawn([process.execPath, "build", "--compile", `--asset=${stage}`, entry, "--outfile", binary], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ])
  if (code !== 0) throw new Error(`bun build --compile failed:\n${stdout}\n${stderr}`)
}, 300_000)

afterAll(() => removeTree(root))

describe("compiled omo __kill-guard dispatch", () => {
  test("#given the judge's allowed probe #when the compiled binary is asked as the shims ask #then the judge allows it and nothing in the home is touched", async () => {
    // given
    const home = freshHome("home-allow")
    const before = listTree(home)

    // when
    const result = await run(
      ["__kill-guard", "check", "--vantage", String(process.pid), "--", "kill", "-0", "1"],
      home,
      {
        SENPI_KILL_GUARD_AGENT_PID: String(process.pid),
      },
    )

    // then
    expect(result.output).not.toContain("Unknown option")
    expect(result.stderr).not.toContain("refused")
    expect(result.code).toBe(0)
    expect(listTree(home)).toEqual(before)
  }, 120_000)

  // The refuse case runs on Linux and macOS.
  test.skipIf(process.platform === "win32")(
    "#given a TERM aimed at the agent itself (rule R2 PROTECTED_TARGET) #when the compiled binary judges it #then it refuses with exit 126",
    async () => {
      // given: a live process stands in for the agent
      const agent = Bun.spawn(["sleep", "120"], { stdout: "ignore", stderr: "ignore" })
      const home = freshHome("home-refuse")
      try {
        // when
        const result = await run(
          ["__kill-guard", "check", "--vantage", String(process.pid), "--", "kill", "-TERM", String(agent.pid)],
          home,
          { SENPI_KILL_GUARD_AGENT_PID: String(agent.pid) },
        )

        // then
        expect(result.output).not.toContain("Unknown option")
        expect(result.stderr).toContain("refused (R2 PROTECTED_TARGET)")
        expect(result.code).toBe(126)
        expect(agent.killed).toBe(false)
      } finally {
        agent.kill()
        await agent.exited
      }
    },
    120_000,
  )

  test("#given the same binary #when it is asked for --version #then the normal boot still answers with the embedded version", async () => {
    // given
    const home = freshHome("home-version")

    // when
    const result = await run(["--version"], home)

    // then
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`omo ${version} (engine: `)
  }, 120_000)
})
