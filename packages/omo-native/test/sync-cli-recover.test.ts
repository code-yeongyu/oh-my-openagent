import { afterAll, expect, test } from "bun:test"
import { Command } from "commander"

import { createRejectionCounter } from "../../memory-core/src/sync/crypto/rejection"
import { createRecoveryBridge } from "../../memory-core/src/sync/recovery/bridge"
import { enrollPhraseRecoveryKey } from "../../memory-core/src/sync/recovery/enroll-phrase"
import { generateRecoveryPhrase, TypedPhrase } from "../../memory-core/src/sync/recovery/phrase"
import { fakeAuthenticator } from "../../memory-core/src/sync/recovery/testing/fake-passkey.test-support"
import {
  createWorld,
  freshStateDir,
  newDevice,
  removeWorldStateDirs,
  transportFor,
  verified,
} from "../../memory-core/src/sync/recovery/testing/world.test-support"
import { configureSyncCommands, EXIT_UNSUPPORTED_HERE, type SyncCommandDependencies } from "../sync-cli"
import type { PhraseTerminal } from "../sync-phrase-tty"

afterAll(removeWorldStateDirs)

const words = (fill: number): ReadonlyArray<string> => {
  const phrase = generateRecoveryPhrase((bytes) => void bytes.fill(fill))
  const out = phrase.reveal()
  phrase.dispose()
  return out
}
const ENROLLED = words(17)

const enrolledAccount = async () => {
  const world = await createWorld()
  let shown: ReadonlyArray<string> = []
  const enrolled = await enrollPhraseRecoveryKey({
    anchor: world.anchor,
    account: world.account,
    keyring: world.owner.keyring,
    bridge: createRecoveryBridge(fakeAuthenticator(world.provider), world.owner.keyring, {
      phraseSurface: {
        show: async (phrase) => {
          shown = phrase.reveal()
          return true
        },
        confirm: async (positions) => new TypedPhrase(positions.map((p) => shown[p - 1] ?? "").join(" ")),
        enter: async () => null,
      },
      phraseRandom: { phrase: () => generateRecoveryPhrase((bytes) => void bytes.fill(17)), positions: () => [1, 2, 3] },
    }),
    chain: { ...transportFor(world, world.owner), listEntriesAfter: async () => null, state: async () => null },
    rejections: createRejectionCounter(),
    pinDir: freshStateDir(),
    phraseGate: { enabled: true, serviceFloor: async () => "on", refused: () => undefined },
  })
  if (!enrolled.ok) throw new Error("fixture enrollment failed")
  return world
}

const typing = (entries: ReadonlyArray<string>) => {
  const written: string[] = []
  let opened = 0
  let next = 0
  const open = (): PhraseTerminal => {
    opened += 1
    return {
      write: (text) => void written.push(text),
      readLine: async () => (next < entries.length ? (entries[next++] ?? null) : null),
      close: () => undefined,
    }
  }
  return { open, written, opened: () => opened }
}

const unused = async (): Promise<never> => {
  throw new Error("not used by recover")
}

const runRecover = async (dependencies: Partial<SyncCommandDependencies>) => {
  const world = await enrolledAccount()
  const fresh = await newDevice()
  const out: string[] = []
  const err: string[] = []
  const initial = process.exitCode
  const program = new Command("omo").exitOverride()
  configureSyncCommands(program, {
    context: async () => ({
      account: world.account,
      serviceDeviceId: "svc-fresh",
      keyring: fresh.keyring,
      pinDir: freshStateDir(),
      chain: { ...transportFor(world, fresh), listEntriesAfter: async () => null, state: async () => null },
      pairing: {
        setAccountSync: unused,
        setDeviceSync: unused,
        listPending: unused,
        openPending: unused,
        readPending: unused,
        answerPending: unused,
        revealPending: unused,
      },
      authority: { signal: new AbortController().signal, admit: (dispatch) => dispatch() },
    }),
    clock: { now: () => 0, sleep: async () => undefined },
    output: (line) => void out.push(line),
    error: (line) => void err.push(line),
    confirm: async () => false,
    interactive: true,
    env: {},
    terminalAvailable: () => true,
    ...dependencies,
  })
  await program.parseAsync(["sync", "recover"], { from: "user" })
  const exit = process.exitCode
  process.exitCode = initial ?? 0
  return { world, out, err, exit }
}

for (const marker of ["PI_CODING_AGENT", "AI_AGENT", "CI"] as const) {
  test(`#given ${marker} is set (even empty) #when omo sync recover runs #then it refuses with exit 2 before opening the terminal`, async () => {
    const terminal = typing([ENROLLED.join(" ")])
    const r = await runRecover({ env: { [marker]: "" }, terminal: terminal.open })
    expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
    expect(r.err).toContain("Run `omo sync recover` yourself in a terminal.")
    expect(terminal.opened()).toBe(0)
  })
}

test("#given no controlling terminal #when omo sync recover runs #then it refuses with exit 2 before opening any terminal", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open, terminalAvailable: () => false })
  expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
  expect(terminal.opened()).toBe(0)
})

test("#given the enrolled phrase typed at the terminal #when omo sync recover runs #then the device recovers through the anchored path and joins", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open })
  expect(r.exit).toBe(0)
  expect(r.out.join("\n")).toContain("recovered")
  const joined = (await verified(r.world, r.world.owner)).received.some((record) => record.body.kind === "recovery-join")
  expect(joined).toBe(true)
  expect(ENROLLED.filter((word) => [...r.out, ...r.err].join(" ").split(/[^a-z]+/u).includes(word))).toEqual([])
})

test("#given a mistyped phrase then a cancel #when omo sync recover runs #then the terminal asks again with the typo reason and the command ends cancelled", async () => {
  const typo = [...ENROLLED.slice(0, 23), ENROLLED[23] === "zoo" ? "abandon" : "zoo"].join(" ")
  const terminal = typing([typo])
  const r = await runRecover({ terminal: terminal.open })
  expect(r.exit).toBe(1)
  expect(terminal.written.join("")).toContain("check for a typo")
  expect(r.err.join("\n")).toContain("cancelled")
})

test("#given a valid phrase this account never enrolled #when omo sync recover runs #then it refuses as history-incomplete and nothing joins", async () => {
  const terminal = typing([words(99).join(" ")])
  const r = await runRecover({ terminal: terminal.open })
  expect(r.exit).toBe(1)
  expect(r.err.join("\n")).toContain("history looks incomplete")
  const joined = (await verified(r.world, r.world.owner)).received.some((record) => record.body.kind === "recovery-join")
  expect(joined).toBe(false)
})
