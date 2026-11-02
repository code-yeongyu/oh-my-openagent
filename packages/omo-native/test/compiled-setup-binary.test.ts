import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../test-support/remove-tree"

// Compiled-binary contract (#10429): inside `bun build --compile` the launcher's package paths point
// into the binary's virtual filesystem, so `omo setup` has to read the engine model catalog and the
// bundled skills from what the binary carries. Only a real compiled executable exercises that.
const exe = process.platform === "win32" ? ".exe" : ""
const root = mkdtempSync(join(tmpdir(), "omo-compiled-setup-"))
const binary = join(root, "build", `omo${exe}`)
const runtimeRoot = join(root, "runtime")
const home = join(root, "home")

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

beforeAll(async () => {
  write(join(runtimeRoot, "package.json"), JSON.stringify({ version: "0.0.0-fixture" }))
  write(join(runtimeRoot, "plugin", "skills", "ultrawork", "SKILL.md"), "---\nname: ultrawork\ndescription: bundled\n---\n")
  write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "openai/gpt-5.5" }))
  write(join(home, ".config", "opencode", "skills", "ultrawork", "SKILL.md"), "---\nname: ultrawork\ndescription: user copy\n---\n")
  const entry = join(import.meta.dir, "fixtures", "compiled-setup", "entry.ts")
  const build = Bun.spawn([process.execPath, "build", "--compile", entry, "--outfile", binary], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
  if (code !== 0) throw new Error(`bun build --compile failed:\n${stdout}\n${stderr}`)
}, 300_000)

afterAll(() => removeTree(root))

describe("compiled omo setup --dry-run", () => {
  test("#given an OpenCode default model and a user skill named like a bundled one #when the compiled binary plans setup #then it carries the model choice and skips the bundled skill", async () => {
    // given: a cwd outside any node_modules tree, so nothing but the binary can answer the engine lookups
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      XDG_CACHE_HOME: join(home, ".cache"),
      DO_NOT_TRACK: "1",
      OMO_COMPILED_SETUP_RUNTIME_ROOT: runtimeRoot,
    }

    // when
    const child = Bun.spawn([binary, "setup", "--dry-run"], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}\n${stderr}`

    // then
    expect(code).toBe(0)
    expect(output).not.toContain("could not read the engine's model list")
    expect(output).toContain("planned-model-choices: default model")
    expect(output).toContain("skills-skipped-bundled: ultrawork")
  }, 120_000)
})
