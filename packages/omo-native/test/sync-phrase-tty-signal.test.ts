import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// #13337 review L2 / L1: a signal that ends the process in the middle of the phrase ceremony puts the terminal back
// (normal mode, main screen) and leaves no listener behind; a normal close leaves no terminal descriptor open.
type Outcome = {
  readonly raw_during: boolean | null
  readonly echo_after: boolean
  readonly canonical_after: boolean
  readonly left_alternate_screen: boolean
  readonly signal: string | null
  readonly exit_code: number | null
}

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const drive = async (mode: string, action: string) => {
  const dir = await mkdtemp(join(tmpdir(), "omo-tty-signal-"))
  dirs.push(dir)
  const report = join(dir, "report.txt")
  const child = Bun.spawn(
    [
      "python3",
      join(import.meta.dir, "fixtures/pty-signal-restore.py"),
      join(import.meta.dir, "fixtures/tty-signal-restore.fixture.ts"),
      mode,
      action,
      report,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TMPDIR: dir, PI_CODING_AGENT: undefined, AI_AGENT: undefined, CI: undefined },
    },
  )
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  expect(code).toBe(0)
  const lines = (await readFile(report, "utf8")).trim().split("\n")
  return { outcome: JSON.parse(stdout) as Outcome, lines }
}

const restored = (outcome: Outcome) => {
  expect(outcome.raw_during).toBe(true)
  expect(outcome.echo_after).toBe(true)
  expect(outcome.canonical_after).toBe(true)
  expect(outcome.left_alternate_screen).toBe(true)
}

for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"])
  test.skipIf(process.platform === "win32")(
    `#given the ceremony on its first prompt #when ${signal} ends the process #then the terminal is back in normal mode on the main screen and the process still ends by ${signal}`,
    async () => {
      const { outcome, lines } = await drive("signal", signal)
      restored(outcome)
      expect(outcome.signal).toBe(signal)
      expect(lines[0]).toStartWith("BEFORE listeners=0,0,0 ")
      expect(lines[1]).toBe("OPEN listeners=1,1,1")
    },
    40_000,
  )

test.skipIf(process.platform === "win32")(
  "#given a host that listens for SIGTERM itself #when SIGTERM arrives mid-ceremony #then the terminal is restored, the host keeps the process and the ceremony's listeners are gone",
  async () => {
    const { outcome, lines } = await drive("survive", "SIGTERM")
    restored(outcome)
    expect(outcome.exit_code).toBe(0)
    expect(lines).toContain("AFTER_SIGNAL listeners=0,1,0")
  },
  40_000,
)

test.skipIf(process.platform === "win32")(
  "#given the ceremony on its first prompt #when Ctrl+C cancels it #then close restores the terminal, removes the listeners and leaves no terminal descriptor open",
  async () => {
    const { outcome, lines } = await drive("close", "ctrl-c")
    restored(outcome)
    expect(outcome.exit_code).toBe(0)
    const before = lines[0]?.match(/descriptors=(\d+)/)?.[1]
    expect(lines).toContain("AFTER_CLOSE confirmed=false listeners=0,0,0")
    expect(lines.at(-1)).toBe(`EXIT descriptors=${before}`)
  },
  40_000,
)
