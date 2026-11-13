import { afterEach, expect, test } from "bun:test"
import { Command } from "commander"

import { ACCOUNT, fixture } from "../../memory-core/src/sync/account/testing/genesis-enable.test-support"
import { BIP39_ENGLISH_ROWS } from "../../memory-core/src/sync/recovery/bip39/english"
import { configureSyncCommands, EXIT_UNSUPPORTED_HERE, PHRASE_GENESIS_FLAG, type SyncCommandDependencies } from "../sync-cli"
import type { SyncContext } from "../sync-context"
import type { PhraseTerminal } from "../sync-phrase-tty"

const WORDS = new Set(BIP39_ENGLISH_ROWS.join(" ").split(" "))
const initialExitCode = process.exitCode
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  process.exitCode = initialExitCode ?? 0
  for (const close of cleanups.splice(0).reverse()) await close()
})

const scriptedTerminal = () => {
  const written: string[] = []
  let opened = 0
  const open = (): PhraseTerminal => {
    opened += 1
    return {
      write: (text) => void written.push(text),
      readLine: async () => {
        const screen = written.join("")
        const asked = /Type words ([0-9, ]+) of your recovery phrase/.exec(screen.slice(screen.lastIndexOf("Type words")))
        if (asked === null || screen.lastIndexOf("Type words") < screen.lastIndexOf("press Enter")) return ""
        const shown = [...screen.matchAll(/^ ?([0-9]{1,2})\. ([a-z]+)\r*$/gmu)].map((match) => match[2] ?? "")
        return (asked[1] ?? "").split(", ").map((position) => shown[Number(position) - 1] ?? "").join(" ")
      },
      close: () => undefined,
    }
  }
  return { open, written, opened: () => opened }
}

const shownWords = (terminal: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...terminal.join("").matchAll(/^ ?[0-9]{1,2}\. ([a-z]+)\r*$/gmu)].map((match) => match[1] ?? "")
// The CLI's own copy uses ordinary words that are also in the BIP39 list ("memory", "device"); a leak is a word that
// was actually shown on the terminal and then appears in stdout or stderr.
const leaked = (shown: ReadonlyArray<string>, lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const tokens = new Set(lines.flatMap((line) => line.toLowerCase().split(/[^a-z]+/u)))
  return shown.filter((word) => WORDS.has(word) && tokens.has(word))
}

const runEnable = async (dependencies: Partial<SyncCommandDependencies>) => {
  const f = await fixture()
  cleanups.push(f.close)
  const { genesis: _genesis, method: _method, rpId: _rp, userName: _user, roaming: _roaming, ...base } = f.input
  const context: SyncContext = { ...base, authority: { signal: new AbortController().signal, admit: (dispatch) => dispatch() } }
  const out: string[] = []
  const err: string[] = []
  const program = new Command("omo").exitOverride()
  configureSyncCommands(program, {
    context: async () => context,
    clock: { now: () => 0, sleep: async () => undefined },
    output: (line) => void out.push(line),
    error: (line) => void err.push(line),
    confirm: async () => false,
    interactive: true,
    terminalAvailable: () => true,
    phraseFloor: async () => "on",
    ...dependencies,
  })
  await program.parseAsync(["sync", "enable"], { from: "user" })
  return { f, out, err, exit: process.exitCode }
}

for (const marker of ["PI_CODING_AGENT", "AI_AGENT", "CI"] as const) {
  test(`#given ${marker} is set (even empty) #when enable must create a phrase #then it refuses before any terminal opens, writes nothing and exits 2`, async () => {
    const terminal = scriptedTerminal()
    const r = await runEnable({ env: { [PHRASE_GENESIS_FLAG]: "1", [marker]: "" }, terminal: terminal.open })
    expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
    expect(r.err).toContain("Run `omo sync enable` yourself in a terminal.")
    expect(terminal.opened()).toBe(0)
    expect(r.f.entries).toEqual([])
    expect(r.f.server.switches).toEqual([])
  })
}

test("#given no controlling terminal (stdin piped, no tty) #when enable must create a phrase #then it refuses and never reads stdin", async () => {
  const terminal = scriptedTerminal()
  const r = await runEnable({ env: { [PHRASE_GENESIS_FLAG]: "1" }, terminal: terminal.open, terminalAvailable: () => false })
  expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
  expect(r.err).toContain("Run `omo sync enable` yourself in a terminal.")
  expect(terminal.opened()).toBe(0)
  expect(r.f.entries).toEqual([])
})

test("#given the phrase flag off #when enable must create a phrase #then it says creation is unavailable and never calls recovery optional", async () => {
  const terminal = scriptedTerminal()
  const r = await runEnable({ env: {}, terminal: terminal.open })
  expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
  expect(r.err.join("\n")).toContain("isn't available on this device yet")
  expect(terminal.opened()).toBe(0)
})

test("#given a person at the terminal #when enable creates a phrase genesis #then the words appear only on the terminal, never in stdout or stderr", async () => {
  const terminal = scriptedTerminal()
  const r = await runEnable({ env: { [PHRASE_GENESIS_FLAG]: "1" }, terminal: terminal.open })
  expect(r.exit).toBe(0)
  expect(r.out).toContain("Memory sync is on for this device.")
  const shown = shownWords(terminal.written)
  expect(shown.length).toBe(24)
  expect(leaked(shown, [...r.out, ...r.err])).toEqual([])
  expect(terminal.written.join("")).toContain(`Save your recovery phrase for ${ACCOUNT}`)
  expect(terminal.written.at(-1)).toContain("\u001b[?1049l")
})
