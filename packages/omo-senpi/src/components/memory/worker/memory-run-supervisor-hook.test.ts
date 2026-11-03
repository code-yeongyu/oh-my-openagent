import { expect, onTestFinished, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("#given hook mode #when unrelated supervisor modules cannot load #then the real staged checker still runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-hook-startup-"))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const preload = join(root, "forbid-supervisor.ts")
  await writeFile(preload, String.raw`
import { plugin } from "bun"
plugin({
  name: "forbid-supervisor-startup",
  setup(build) {
    build.onLoad({
      filter: /[/\\](supervisor-admission|supervisor-child-bootstrap|run-artifacts|run-outcome-publication|supervisor-process-identity)\.ts$/,
    }, () => { throw new Error("UNRELATED_SUPERVISOR_IMPORT") })
  },
})
`)
  const git = Bun.spawn(["git", "init", "--quiet", root], { stdout: "pipe", stderr: "pipe" })
  expect(await git.exited).toBe(0)
  const argv = [
    process.execPath, "--preload", preload,
    join(import.meta.dir, "memory-run-supervisor.ts"), "--memory-hook", "pre-commit",
  ]
  const child = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" })

  await writeFile(join(root, "note.md"), "---\ndescription: one\ndescription: two\n---\nbody\n")
  const add = Bun.spawn(["git", "add", "note.md"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  expect(await add.exited).toBe(0)
  const invalid = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [invalidCode, diagnostic, invalidStderr] = await Promise.all([
    invalid.exited,
    new Response(invalid.stdout).text(),
    new Response(invalid.stderr).text(),
  ])
  expect({ code: invalidCode, stderr: invalidStderr }).toEqual({ code: 1, stderr: "" })
  expect(diagnostic.length).toBeGreaterThan(0)
})
