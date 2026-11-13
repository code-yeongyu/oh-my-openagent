import { afterEach, expect, test } from "bun:test"
import { Command } from "commander"

import { ACCOUNT, fixture } from "../../memory-core/src/sync/account/testing/genesis-enable.test-support"
import { BIP39_ENGLISH_ROWS } from "../../memory-core/src/sync/recovery/bip39/english"
import { writePhraseGenesisMarker } from "../../memory-core/src/sync/genesis/phrase-marker"
import { phraseMarkerExists } from "../../memory-core/src/sync/account/testing/phrase-enable.test-support"
import { phraseNoticeStatus } from "../../memory-core/src/sync/account/phrase-notice"
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

// Review LOW (#13337 @ c11d6cfd): the CLI's own fixed copy ("Memory sync is on for this device.") holds BIP39 words,
// so a random phrase containing "memory" or "device" failed ~2.3% of runs. Fixed copy lines are removed first; a
// leak is a shown word in any other output line.
const CLI_COPY = new Set(["Memory sync is on for this device.", "Your memory is recovered on this device and memory sync is on."])
const leakedWords = (shown: ReadonlyArray<string>, lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const tokens = new Set(lines.filter((line) => !CLI_COPY.has(line)).flatMap((line) => line.toLowerCase().split(/[^a-z]+/u)))
  return shown.filter((word) => WORDS.has(word) && tokens.has(word))
}

const shownWords = (terminal: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...terminal.join("").matchAll(/^ ?[0-9]{1,2}\. ([a-z]+)\r*$/gmu)].map((match) => match[1] ?? "")

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

test("#given the terminal check reports no controlling terminal #when enable must create a phrase #then it refuses before opening any terminal and writes nothing", async () => {
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
  expect(leakedWords(shown, [...r.out, ...r.err])).toEqual([])
  expect(terminal.written.join("")).toContain(`Save your recovery phrase for ${ACCOUNT}`)
  expect(terminal.written.at(-1)).toContain("\u001b[?1049l")
})

test("#given a shown phrase that contains memory and device #when the only output is the CLI's success line #then no leak is reported (no random false failure)", () => {
  expect(leakedWords(["memory", "device", "abandon"], ["Memory sync is on for this device."])).toEqual([])
  expect(leakedWords(["memory", "device", "abandon"], ["debug: abandon"])).toEqual(["abandon"])
})

test("#given a void notice on the terminal #when the person cancels it instead of pressing Enter #then stderr says nothing changed and the notice is not acknowledged", async () => {
  const terminal = { opened: 0 }
  const open = (): PhraseTerminal => {
    terminal.opened += 1
    return { write: () => undefined, readLine: async () => null, close: () => undefined }
  }
  const f = await fixture()
  cleanups.push(f.close)
  await writePhraseGenesisMarker({ pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }, {
    version: 1,
    account: ACCOUNT,
    startedAt: 0,
  })
  const { genesis: _genesis, method: _method, rpId: _rp, userName: _user, roaming: _roaming, ...base } = f.input
  const err: string[] = []
  const program = new Command("omo").exitOverride()
  configureSyncCommands(program, {
    context: async () => ({ ...base, authority: { signal: new AbortController().signal, admit: (dispatch) => dispatch() } }),
    clock: { now: () => 0, sleep: async () => undefined },
    output: () => undefined,
    error: (line) => void err.push(line),
    confirm: async () => false,
    interactive: true,
    env: { [PHRASE_GENESIS_FLAG]: "1" },
    terminal: open,
    terminalAvailable: () => true,
    phraseFloor: async () => "on",
  })
  await program.parseAsync(["sync", "enable"], { from: "user" })
  expect(err.join("\n")).toContain("nothing changed")
  expect(terminal.opened).toBe(1)
  // Review LOW (#13337 @ 6e726034): the notice really was NOT acknowledged - the marker stays and still reads void.
  const place = { pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }
  expect(await phraseMarkerExists(f.input.pinDir, place.principalId)).toBe(true)
  expect(await phraseNoticeStatus(place)).toEqual({ phraseVoid: { purpose: "genesis" } })
})
