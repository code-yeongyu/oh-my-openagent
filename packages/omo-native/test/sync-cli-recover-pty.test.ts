import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateRecoveryPhrase } from "../../memory-core/src/sync/recovery/phrase"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const words = (fill: number): ReadonlyArray<string> => {
  const phrase = generateRecoveryPhrase((bytes) => void bytes.fill(fill))
  const out = phrase.reveal()
  phrase.dispose()
  return out
}
const ENROLLED = words(17)
const tokens = (text: string): ReadonlySet<string> => new Set(text.toLowerCase().split(/[^a-z]+/u))

const drive = async (type: ReadonlyArray<string>, env: Record<string, string | undefined> = {}) => {
  const dir = await mkdtemp(join(tmpdir(), "omo-recover-pty-"))
  dirs.push(dir)
  const [out, err, pty] = ["stdout.txt", "stderr.txt", "pty.txt"].map((name) => join(dir, name))
  const child = Bun.spawn(
    ["python3", join(import.meta.dir, "fixtures/pty-drive-recover.py"), join(import.meta.dir, "fixtures/sync-recover-phrase-pty.fixture.ts"), out ?? "", err ?? "", pty ?? ""],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TMPDIR: dir, PI_CODING_AGENT: undefined, AI_AGENT: undefined, CI: undefined, PTY_TYPE: type.join("|"), ...env },
    },
  )
  const exit = await child.exited
  const read = async (path: string | undefined) => readFile(path ?? "", "utf8").catch(() => "")
  return { exit, stdout: await read(out), stderr: await read(err), screen: await read(pty) }
}

// Contract sec 7 / review F5: the phrase is typed only on the controlling terminal; with stdout and stderr
// redirected to files, no typed word reaches either, on success and on every refusal path.
const posix = test.skipIf(process.platform === "win32")

posix("#given the enrolled phrase typed on a real pty #when omo sync recover runs #then it recovers and no typed word reaches stdout or stderr", async () => {
  const r = await drive([ENROLLED.join(" ")])
  expect(r.exit).toBe(0)
  expect(r.stdout).toContain("recovered")
  const written = tokens(`${r.stdout}\n${r.stderr}`)
  expect(ENROLLED.filter((word) => written.has(word))).toEqual([])
}, 60_000)

posix("#given a mistyped phrase twice then Ctrl+C #when omo sync recover runs #then the typo reason is shown on the terminal only and nothing is recovered", async () => {
  const typo = [...ENROLLED.slice(0, 23), ENROLLED[23] === "zoo" ? "abandon" : "zoo"].join(" ")
  const r = await drive([typo, typo])
  expect(r.exit).toBe(1)
  expect(r.screen).toContain("check for a typo")
  expect(r.stderr).toContain("cancelled")
  const written = tokens(`${r.stdout}\n${r.stderr}`)
  expect(ENROLLED.filter((word) => written.has(word))).toEqual([])
}, 60_000)

posix("#given a valid phrase that this account never enrolled #when omo sync recover runs #then it refuses as history-incomplete and none of its words reach stdout or stderr", async () => {
  const other = words(99)
  const r = await drive([other.join(" ")])
  expect(r.exit).toBe(1)
  expect(r.stderr).toContain("history looks incomplete")
  const written = tokens(`${r.stdout}\n${r.stderr}`)
  expect(other.filter((word) => written.has(word))).toEqual([])
}, 60_000)

for (const marker of ["PI_CODING_AGENT", "AI_AGENT", "CI"] as const) {
  posix(`#given ${marker} set in the environment #when omo sync recover runs on a real pty #then it refuses with exit 2 and never asks for the phrase`, async () => {
    const r = await drive([ENROLLED.join(" ")], { [marker]: "1" })
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain("Run `omo sync recover` yourself in a terminal.")
    expect(r.screen).not.toContain("Type your 24-word recovery phrase")
  }, 60_000)
}

posix("#given no controlling terminal (setsid, stdin piped with the phrase) #when omo sync recover runs #then it refuses with exit 2 and never reads stdin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omo-recover-notty-"))
  dirs.push(dir)
  const child = Bun.spawn(["setsid", "-w", "bun", join(import.meta.dir, "fixtures/sync-recover-phrase-pty.fixture.ts")], {
    stdin: new TextEncoder().encode(`${ENROLLED.join(" ")}\n`),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TMPDIR: dir, PI_CODING_AGENT: undefined, AI_AGENT: undefined, CI: undefined },
  })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(exit).toBe(2)
  expect(stderr).toContain("Run `omo sync recover` yourself in a terminal.")
  expect(ENROLLED.filter((word) => tokens(`${stdout}\n${stderr}`).has(word))).toEqual([])
}, 60_000)
