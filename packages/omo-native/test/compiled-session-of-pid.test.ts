import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../test-support/remove-tree"

// Compiled-binary contract (omo#14253; built the way #13449's test builds it): inside a compiled binary the kill guard's shims run the binary itself as
// `<binary> __kill-guard check --vantage <pid> -- <argv...>` (the engine leaves the judge entry empty there), so the
// compiled entry must hand that hidden subcommand to the engine's judge before it boots anything. Only a real compiled
// executable built from compile-entry.ts exercises that route; the embedded runtime is the smallest one it accepts.
const exe = process.platform === "win32" ? ".exe" : ""
const root = mkdtempSync(join(tmpdir(), "omo-compiled-session-of-pid-"))
const binary = join(root, "build", `omo${exe}`)
const version = "0.0.0-session-of-pid-fixture"

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
    cwd: "/",
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

// The engine's own answers (senpi session-of-pid-command.ts): a JSON line on stdout and nothing else, for the
// well-formed call and for its usage errors; a flag before the verb is not its form, so the general parser answers it.
describe("compiled omo session-of-pid (omo#14253)", () => {
  const jsonOnly = (stdout: string) => {
    const lines = stdout.trim().split("\n")
    expect(lines).toHaveLength(1)
    return JSON.parse(lines[0] ?? "") as Record<string, unknown>
  }

  test("#given a pid #when the compiled binary is asked session-of-pid <pid> --json from / #then stdout is the engine's one JSON answer", async () => {
    const result = await run(["session-of-pid", String(process.pid), "--json"], freshHome("home-pid"))
    expect(result.output).not.toContain("Unknown option")
    expect(jsonOnly(result.stdout)).toMatchObject({ version: 1, ok: true, pid: process.pid })
    expect([0, 1]).toContain(result.code)
  }, 120_000)

  test.each([
    ["a non-numeric pid", ["session-of-pid", "abc", "--json"]],
    ["an extra argument", ["session-of-pid", "1", "--json", "extra"]],
  ])(
    "#given %s #when the compiled binary is asked #then the engine's usage error answers, exit 2",
    async (_label, args) => {
      const result = await run(args, freshHome("home-bad"))
      expect(jsonOnly(result.stdout)).toMatchObject({ version: 1, ok: false, code: "invalid_arguments" })
      expect(result.code).toBe(2)
    },
    120_000,
  )

  test("#given the flag before the verb #when the compiled binary is asked #then it is not the command's form and nothing answers as it", async () => {
    const result = await run(["--json", "session-of-pid", "1"], freshHome("home-flag"))
    expect(result.stdout).not.toContain('"version":1')
    expect(result.code).not.toBe(0)
  }, 120_000)
})
