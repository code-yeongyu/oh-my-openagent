import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BIP39_ENGLISH_ROWS } from "../../memory-core/src/sync/recovery/bip39/english"

const WORDS = new Set(BIP39_ENGLISH_ROWS.join(" ").split(" "))
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const shownIn = (screen: string): ReadonlyArray<string> =>
  [...screen.matchAll(/^ ?[0-9]{1,2}\. ([a-z]+)\r*$/gmu)]
    .map((match) => match[1] ?? "")
    .filter((word) => WORDS.has(word))
const tokensOf = (text: string): ReadonlySet<string> => new Set(text.toLowerCase().split(/[^a-z]+/u))

// Contract sec 7 / review F5: on a real controlling terminal with stdout and stderr redirected to files, the phrase
// genesis completes and neither file holds a single wordlist word; the words reach only the terminal.
test.skipIf(process.platform === "win32")(
  "#given stdout and stderr redirected to files and a real pty as the terminal #when a phrase genesis runs #then no word reaches either file",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "omo-phrase-pty-"))
    dirs.push(dir)
    const [out, err, transcript] = ["stdout.txt", "stderr.txt", "pty.txt"].map((name) => join(dir, name))
    const child = Bun.spawn(
      [
        "python3",
        join(import.meta.dir, "fixtures/pty-drive-phrase.py"),
        join(import.meta.dir, "fixtures/sync-enable-phrase-pty.fixture.ts"),
        out ?? "",
        err ?? "",
        transcript ?? "",
      ],
      // The child's temp dirs live in this test's own dir, removed in afterEach even if the child is killed.
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, TMPDIR: dir, PI_CODING_AGENT: undefined, AI_AGENT: undefined, CI: undefined },
      },
    )
    expect(await child.exited).toBe(0)
    const stdout = await readFile(out ?? "", "utf8")
    const stderr = await readFile(err ?? "", "utf8")
    expect(stdout).toContain("Memory sync is on for this device.")
    const shown = shownIn(await readFile(transcript ?? "", "utf8"))
    expect(shown.length).toBe(24)
    // The success line is CLI copy that holds BIP39 words ("memory", "device"); only other lines can leak.
    const written = tokensOf(
      `${stdout}\n${stderr}`
        .split("\n")
        .filter((line) => line !== "Memory sync is on for this device.")
        .join("\n"),
    )
    expect(shown.filter((word) => written.has(word))).toEqual([])
  },
  60_000,
)
